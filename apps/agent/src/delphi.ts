import { readFile } from "node:fs/promises";
import type { Market } from "@oracle-scout/evidence";

/**
 * Delphi (Gensyn) adapter.
 *
 * Reads follow the published SDK (@gensyn-ai/gensyn-delphi-sdk 2.1.0):
 *   GET {base}/markets?status=open&limit=..&skip=..   headers: X-API-Key, X-Delphi-Mode: competition
 *   base = https://delphi-api.gensyn.ai/ (testnet and competition-testnet share it)
 * The evidence-submission API is published when the arena opens (23 Nov 2026), so the
 * submit path and agent-identity header names are configuration, not code.
 */

export interface DelphiConfig {
  baseUrl: string;
  apiKey?: string;
  competition: boolean;
  competitionId?: string;
  submitPath: string;
  receiptPath: string;
  feedbackPath: string;
  agent: { id: string; harness: string; model: string };
  agentHeaders: { id: string; harness: string; model: string };
  fetchImpl?: typeof fetch;
}

export function delphiConfigFromEnv(env = process.env, agent: DelphiConfig["agent"]): DelphiConfig {
  return {
    baseUrl: env.DELPHI_API_BASE_URL || "https://delphi-api.gensyn.ai/",
    apiKey: env.DELPHI_API_ACCESS_KEY || undefined,
    competition: (env.DELPHI_NETWORK ?? "competition-testnet").startsWith("competition"),
    competitionId: env.DELPHI_COMPETITION_ID || undefined,
    submitPath: env.DELPHI_EVIDENCE_PATH || "/evidence",
    receiptPath: env.DELPHI_RECEIPT_PATH || "/evidence/{id}",
    feedbackPath: env.DELPHI_FEEDBACK_PATH || "/feedback",
    agent,
    agentHeaders: {
      id: env.DELPHI_HEADER_AGENT_ID || "X-Agent-Id",
      harness: env.DELPHI_HEADER_HARNESS || "X-Agent-Harness",
      model: env.DELPHI_HEADER_MODEL || "X-Agent-Model",
    },
  };
}

export interface EvidenceFile {
  name: string;
  contentType: string;
  content: string;
}

export interface SubmitRequest {
  marketId: string;
  note: string;
  links: string[];
  files: EvidenceFile[];
}

export interface SubmitResult {
  remoteId?: string;
  raw: unknown;
}

export interface Receipt {
  verdict?: string;
  rationale?: string;
  reward?: number;
  raw: unknown;
}

export interface MarketSource {
  listMarkets(): Promise<Market[]>;
}

export interface EvidenceSink {
  submit(req: SubmitRequest): Promise<SubmitResult>;
  receipt?(remoteId: string): Promise<Receipt | null>;
  feedback?(text: string): Promise<void>;
}

/** Raw Delphi market (subset of the SDK's Market type) -> platform-neutral Market. */
export function toMarket(raw: Record<string, unknown>): Market {
  const meta = (raw.metadata ?? {}) as { question?: string; title?: string; description?: string; resolutionCriteria?: string; outcomes?: string[]; endDate?: string; category?: string };
  const pick = (...keys: string[]) => keys.map((k) => raw[k]).find((v) => v !== undefined && v !== null);
  const outcomes = meta.outcomes ?? ["Yes", "No"];
  const yesIdx = Math.max(0, outcomes.findIndex((o) => /^yes$/i.test(o)));
  const probs = pick("impliedProbabilities", "probabilities") as number[] | undefined;
  const odds = pick("yesPrice", "odds", "probability") as number | undefined;
  return {
    id: String(raw.id),
    question: meta.question ?? meta.title ?? String(pick("question", "title") ?? ""),
    description: [meta.description, meta.resolutionCriteria && `Resolution: ${meta.resolutionCriteria}`].filter(Boolean).join("\n") || undefined,
    closeTime: String(pick("resolvesAt", "settlesAt", "closeTime") ?? meta.endDate ?? ""),
    evidenceCutoff: pick("evidenceCutoff", "evidenceCutoffAt", "evidence_cutoff") as string | undefined,
    yesPrice: Array.isArray(probs) ? probs[yesIdx] : typeof odds === "number" ? odds : undefined,
    category: (raw.category as string) ?? meta.category,
    url: raw.marketUrl as string | undefined,
    extra: { appMarketId: raw.appMarketId, rewardPot: pick("rewardPot", "reward_pot"), dataSources: raw.dataSources, status: raw.status, outcomes },
  };
}

export class DelphiHttp implements MarketSource, EvidenceSink {
  private readonly f: typeof fetch;
  constructor(private readonly cfg: DelphiConfig) {
    this.f = cfg.fetchImpl ?? fetch;
  }

  private headers(json = false): Record<string, string> {
    if (!this.cfg.apiKey) throw new Error("DELPHI_API_ACCESS_KEY is not set (keys are issued when the arena opens on 23 Nov)");
    const { agentHeaders: h, agent } = this.cfg;
    return {
      "X-API-Key": this.cfg.apiKey,
      Accept: "application/json",
      ...(this.cfg.competition ? { "X-Delphi-Mode": "competition" } : {}),
      [h.id]: agent.id,
      [h.harness]: agent.harness,
      [h.model]: agent.model,
      ...(json ? { "Content-Type": "application/json" } : {}),
    };
  }

  private url(path: string, q: Record<string, string | number | undefined> = {}): string {
    const u = new URL(path.replace(/^\//, ""), this.cfg.baseUrl.endsWith("/") ? this.cfg.baseUrl : `${this.cfg.baseUrl}/`);
    for (const [k, v] of Object.entries(q)) if (v !== undefined) u.searchParams.set(k, String(v));
    return u.toString();
  }

  private async json<T>(res: Response): Promise<T> {
    const text = await res.text();
    if (!res.ok) throw new Error(`Delphi ${res.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  async listMarkets(): Promise<Market[]> {
    const out: Market[] = [];
    for (let skip = 0; skip < 1000; skip += 50) {
      const res = await this.f(this.url("/markets", { status: "open", limit: 50, skip, competitionId: this.cfg.competitionId }), { headers: this.headers() });
      const { markets } = await this.json<{ markets: Record<string, unknown>[] | null }>(res);
      if (!markets?.length) break;
      out.push(...markets.map(toMarket));
      if (markets.length < 50) break;
    }
    return out;
  }

  async submit(req: SubmitRequest): Promise<SubmitResult> {
    const res = await this.f(this.url(this.cfg.submitPath), {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({ marketId: req.marketId, note: req.note, links: req.links, files: req.files.slice(0, 3) }),
    });
    const raw = await this.json<Record<string, unknown>>(res);
    return { remoteId: (raw.id ?? raw.submissionId ?? raw.evidenceId) as string | undefined, raw };
  }

  async receipt(remoteId: string): Promise<Receipt | null> {
    const res = await this.f(this.url(this.cfg.receiptPath.replace("{id}", encodeURIComponent(remoteId))), { headers: this.headers() });
    if (res.status === 404) return null;
    const raw = await this.json<Record<string, unknown>>(res);
    return { verdict: raw.verdict as string, rationale: raw.rationale as string, reward: Number(raw.reward ?? raw.judgmentReward ?? NaN), raw };
  }

  async feedback(text: string): Promise<void> {
    await this.json(await this.f(this.url(this.cfg.feedbackPath), { method: "POST", headers: this.headers(true), body: JSON.stringify({ text }) }));
  }
}

/** Offline market list (JSON array of raw Delphi markets or neutral Markets) for rehearsals and tests. */
export class FileMarkets implements MarketSource {
  constructor(private readonly path: string) {}
  async listMarkets(): Promise<Market[]> {
    const data = JSON.parse(await readFile(this.path, "utf8")) as Record<string, unknown>[];
    return data.map((m) => ("question" in m && "closeTime" in m ? (m as unknown as Market) : toMarket(m)));
  }
}

/** Dry-run sink: records what would be sent, sends nothing. */
export class DryRunSink implements EvidenceSink {
  readonly sent: SubmitRequest[] = [];
  async submit(req: SubmitRequest): Promise<SubmitResult> {
    this.sent.push(req);
    return { remoteId: `dry-${this.sent.length}`, raw: { dryRun: true } };
  }
}

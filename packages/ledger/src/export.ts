import { hashObject } from "./hash.js";
import { verifyChain, type AnchorRecord, type LogEntry } from "./log.js";
import { inclusionProof, merkleRoot, type InclusionProof } from "./merkle.js";

/**
 * EU AI Act Article 12-style record-keeping export.
 *
 * Oracle Scout is not a high-risk system under Annex III, but Article 12 is the clearest
 * public template for what an accountable agent's logs should let a reviewer reconstruct:
 *   12(1)    automatic recording of events over the system's lifetime
 *   12(2)(a) situations that may present a risk          -> guardrail blocks, errors
 *   12(2)(b) post-market monitoring                      -> outputs and their receipts/outcomes
 *   12(2)(c) monitoring of operation (Art. 26(5))        -> runs, inputs, decisions
 *   12(3)(a) period of each use                          -> run.start / run.end
 *   12(3)(c) input data                                  -> sources fetched (URL + content hash)
 *   12(3)(d) natural persons verifying results (Art. 14) -> oversight events; accountable owner
 *            reachable through the Agent Registry + Verified by Concordium badge, no personal data
 * Integrity: every entry is hash-chained and each batch root is anchored on Concordium.
 */

export interface AccountableOwner {
  /** Agent Registry identifier (e.g. CAIP-10 / registry agent id). */
  registryAgentId?: string;
  verifiedByConcordium?: boolean;
  /** How a competent authority reaches the human owner: through the identity provider, never via data in this log. */
  lawfulRoute: string;
}

export interface Article12Export {
  format: "oracle-scout/article12-export@1";
  generatedAt: string;
  system: { name: string; version: string; actor: string; purpose: string };
  accountableOwner: AccountableOwner;
  retention: { minimumMonths: number; basis: string };
  integrity: {
    chainValid: boolean;
    chainErrors: string[];
    entries: number;
    headHash: string;
    anchors: (AnchorRecord & { rootMatchesLog: boolean })[];
    unanchoredEntries: number;
  };
  periodsOfUse: { runId: string; start: string; end?: string; summary?: unknown }[];
  inputs: { seq: number; ts: string; source: string; url?: string; contentHash?: string }[];
  outputs: { seq: number; ts: string; kind: string; ref?: string; detail: unknown }[];
  riskEvents: { seq: number; ts: string; kind: string; detail: unknown }[];
  humanOversight: { seq: number; ts: string; detail: unknown }[];
  entries: LogEntry[];
  exportHash: string;
}

type P = Record<string, unknown>;

export function buildArticle12Export(
  entries: LogEntry[],
  opts: { system: Article12Export["system"]; owner: AccountableOwner; redactPayloads?: boolean; now?: Date },
): Article12Export {
  const check = verifyChain(entries);
  const anchors = entries
    .filter((e) => e.kind === "anchor")
    .map((e) => {
      const a = e.payload as AnchorRecord;
      const slice = entries.slice(a.fromSeq, a.toSeq + 1).map((x) => x.entryHash);
      return { ...a, rootMatchesLog: slice.length === a.count && merkleRoot(slice) === a.root };
    });
  const lastAnchored = anchors.length ? anchors[anchors.length - 1]!.toSeq : -1;

  const runs = new Map<string, Article12Export["periodsOfUse"][number]>();
  for (const e of entries) {
    const p = (e.payload ?? {}) as P;
    if (e.kind === "run.start") runs.set(String(p.runId), { runId: String(p.runId), start: e.ts });
    if (e.kind === "run.end") {
      const r = runs.get(String(p.runId));
      if (r) Object.assign(r, { end: e.ts, summary: p.summary });
    }
  }

  const pick = (kinds: string[]) => entries.filter((e) => kinds.includes(e.kind));
  const body = {
    format: "oracle-scout/article12-export@1" as const,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    system: opts.system,
    accountableOwner: opts.owner,
    retention: { minimumMonths: 6, basis: "AI Act Art. 19(1) / Art. 26(6): at least six months" },
    integrity: {
      chainValid: check.ok,
      chainErrors: check.errors,
      entries: entries.length,
      headHash: entries.length ? entries[entries.length - 1]!.entryHash : "",
      anchors,
      unanchoredEntries: entries.length - 1 - lastAnchored,
    },
    periodsOfUse: [...runs.values()],
    inputs: pick(["source.fetch"]).map((e) => {
      const p = (e.payload ?? {}) as P;
      return { seq: e.seq, ts: e.ts, source: String(p.source ?? ""), url: p.url as string, contentHash: p.contentHash as string };
    }),
    outputs: pick(["evidence.created", "evidence.submitted", "evidence.receipt", "pack.sold"]).map((e) => {
      const p = (e.payload ?? {}) as P;
      return { seq: e.seq, ts: e.ts, kind: e.kind, ref: (p.evidenceId ?? p.packId) as string, detail: opts.redactPayloads ? undefined : p };
    }),
    riskEvents: pick(["guardrail.block", "error"]).map((e) => ({ seq: e.seq, ts: e.ts, kind: e.kind, detail: e.payload })),
    humanOversight: pick(["oversight"]).map((e) => ({ seq: e.seq, ts: e.ts, detail: e.payload })),
    entries: opts.redactPayloads ? entries.map(({ payload: _drop, ...rest }) => rest as LogEntry) : entries,
  };
  return { ...body, exportHash: hashObject(body) };
}

/** Flat CSV of the event log (one row per entry) for spreadsheets and auditors. */
export function toCsv(entries: LogEntry[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = [["seq", "ts", "kind", "actor", "payloadHash", "prevHash", "entryHash", "summary"].join(",")];
  for (const e of entries) {
    rows.push(
      [String(e.seq), e.ts, e.kind, e.actor, e.payloadHash, e.prevHash, e.entryHash, summarize(e)].map(esc).join(","),
    );
  }
  return rows.join("\n") + "\n";
}

function summarize(e: LogEntry): string {
  const p = (e.payload ?? {}) as P;
  return String(p.summary ?? p.claim ?? p.url ?? p.reason ?? p.txHash ?? "").slice(0, 200);
}

/** Proof that entry `seq` is covered by the anchor that contains it. */
export function proofForEntry(entries: LogEntry[], seq: number): { anchor: AnchorRecord; proof: InclusionProof } | null {
  const anchor = entries
    .filter((e) => e.kind === "anchor")
    .map((e) => e.payload as AnchorRecord)
    .find((a) => seq >= a.fromSeq && seq <= a.toSeq);
  if (!anchor) return null;
  const hashes = entries.slice(anchor.fromSeq, anchor.toSeq + 1).map((e) => e.entryHash);
  return { anchor, proof: inclusionProof(hashes, seq - anchor.fromSeq) };
}

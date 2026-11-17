import { randomUUID } from "node:crypto";
import {
  checkNovelty,
  mine,
  planMarket,
  type EvidenceItem,
  type HttpGet,
  type Market,
  type Recorder,
  type ResolverPlan,
} from "@oracle-scout/evidence";
import type { AnchorRecord, AuditLog, PendingBatch } from "@oracle-scout/ledger";
import type { AgentConfig } from "./config.js";
import type { EvidenceSink, MarketSource } from "./delphi.js";
import { checkGuardrails, killSwitch } from "./guardrails.js";
import type { AgentState } from "./state.js";

/** Anything that can put a batch root on chain (Concordium in production, a fake in tests). */
export interface Anchorer {
  network: string;
  anchor(batch: PendingBatch, agentId: string): Promise<Pick<AnchorRecord, "txHash" | "explorerUrl">>;
}

export interface RunDeps {
  cfg: AgentConfig;
  log: AuditLog;
  state: AgentState;
  markets: MarketSource;
  sink: EvidenceSink;
  http: HttpGet;
  anchorer?: Anchorer;
  overrides?: Record<string, ResolverPlan>;
  now?: () => Date;
  say?: (line: string) => void;
}

export interface RunSummary {
  runId: string;
  markets: number;
  planned: number;
  evidence: number;
  submitted: number;
  blocked: number;
  abstained: number;
  errors: number;
  anchored?: string;
}

export async function runOnce(d: RunDeps): Promise<RunSummary> {
  const now = d.now ?? (() => new Date());
  const say = d.say ?? (() => undefined);
  const runId = randomUUID();
  const s: RunSummary = { runId, markets: 0, planned: 0, evidence: 0, submitted: 0, blocked: 0, abstained: 0, errors: 0 };
  const recorder: Recorder = { record: (kind, payload) => d.log.append(kind as never, { runId, ...payload }) };

  await d.log.append("run.start", { runId, dryRun: d.cfg.dryRun, limits: d.cfg.limits, agent: { id: d.cfg.agentId, harness: d.cfg.harness, model: d.cfg.model } });
  const ks = killSwitch(d.cfg.dataDir);
  if (ks.engaged) {
    await d.log.append("guardrail.block", { runId, rule: "kill-switch", reason: ks.reason });
    say(`Kill switch engaged (${ks.reason}); nothing will be submitted.`);
  }

  try {
    const markets = await d.markets.listMarkets();
    s.markets = markets.length;
    const triaged = markets
      .map((m) => ({ m, r: planMarket(m, d.overrides) }))
      .filter(({ r }) => r.plan && r.confidence >= d.cfg.limits.minPlanConfidence);
    s.planned = triaged.length;
    await d.log.append("market.triage", {
      runId,
      seen: markets.length,
      planned: triaged.map(({ m, r }) => ({ marketId: m.id, question: m.question, reason: r.reason, confidence: r.confidence })),
    });
    say(`${markets.length} open markets, ${triaged.length} resolvable from primary data.`);

    // soonest cutoff first: early, fresh evidence is what earns
    triaged.sort((a, b) => Date.parse(a.m.evidenceCutoff ?? a.m.closeTime) - Date.parse(b.m.evidenceCutoff ?? b.m.closeTime));

    for (const { m, r } of triaged) {
      try {
        const res = await mine(m, r.plan!, {
          http: d.http,
          now,
          recorder,
          policy: { yesAt: d.cfg.limits.yesAt, noAt: d.cfg.limits.noAt, minEdge: d.cfg.limits.minEdge },
        });
        if (res.status === "abstain") {
          s.abstained++;
          await recorder.record("analysis", { marketId: m.id, decision: "abstain", reason: res.reason, probability: res.probability });
          say(`  · abstain  ${short(m.question)} (${res.reason})`);
          continue;
        }
        s.evidence++;
        const sent = await submitItem(d, m, res.item, s.submitted, recorder, now());
        if (sent) s.submitted++;
        else s.blocked++;
        say(`  ${sent ? "✓ submit " : "× blocked"} ${res.item.stance.padEnd(3)} ${short(m.question)}`);
      } catch (err) {
        s.errors++;
        await recorder.record("error", { marketId: m.id, stage: "mine", message: (err as Error).message });
        say(`  ! error    ${short(m.question)}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    s.errors++;
    await recorder.record("error", { stage: "markets", message: (err as Error).message });
    say(`! could not list markets: ${(err as Error).message}`);
  }

  await d.log.append("run.end", { runId, summary: { ...s } });
  if (d.anchorer) {
    const pending = await d.log.pendingBatch();
    if (pending && pending.count >= d.cfg.anchor.everyEntries) {
      s.anchored = await anchorPending(d.log, d.anchorer, d.cfg.agentId);
      say(`Anchored ${pending.count} log entries on ${d.anchorer.network}: ${s.anchored}`);
    }
  }
  return s;
}

async function submitItem(d: RunDeps, m: Market, item: EvidenceItem, submittedThisRun: number, rec: Recorder, now: Date): Promise<boolean> {
  const history = await d.state.submissions();
  const novelty = checkNovelty(
    item,
    history.map((h) => ({ marketId: h.marketId, text: h.note, fingerprint: h.fingerprint, stance: h.stance, own: true })),
  );
  if (!novelty.novel) {
    await rec.record("guardrail.block", { evidenceId: item.id, marketId: m.id, rule: "novelty", reason: novelty.reason });
    return false;
  }
  const g = checkGuardrails({ item, market: m, history: history.filter((h) => !h.dryRun || d.cfg.dryRun), submittedThisRun, cfg: d.cfg, now });
  if (!g.ok) {
    await rec.record("guardrail.block", { evidenceId: item.id, marketId: m.id, rule: g.rule, reason: g.reason });
    return false;
  }
  await d.state.saveEvidence(item);
  const anchors = await d.log.anchors();
  const lastAnchor = anchors[anchors.length - 1];
  const files = [
    {
      name: `oracle-scout-${item.id}.json`,
      contentType: "application/json",
      content: JSON.stringify(
        {
          evidence: { ...item, note: undefined },
          verify: {
            how: "Every fact carries the exact data URL and sha256 of the response; re-fetch and compare. Our audit log is Merkle-anchored on Concordium.",
            lastAnchor: lastAnchor ? { network: lastAnchor.network, txHash: lastAnchor.txHash, root: lastAnchor.root, explorer: lastAnchor.explorerUrl } : null,
          },
        },
        null,
        2,
      ),
    },
  ];
  const result = await d.sink.submit({ marketId: m.id, note: item.note, links: item.links.slice(0, 5), files });
  await d.state.addSubmission({
    evidenceId: item.id,
    marketId: m.id,
    stance: item.stance,
    fingerprint: item.fingerprint,
    note: item.note,
    submittedAt: now.toISOString(),
    dryRun: d.cfg.dryRun,
    remoteId: result.remoteId,
  });
  await rec.record("evidence.submitted", { evidenceId: item.id, marketId: m.id, stance: item.stance, remoteId: result.remoteId, dryRun: d.cfg.dryRun, fingerprint: item.fingerprint });
  return true;
}

export async function anchorPending(log: AuditLog, anchorer: Anchorer, agentId: string): Promise<string | undefined> {
  const pending = await log.pendingBatch();
  if (!pending) return undefined;
  const { txHash, explorerUrl } = await anchorer.anchor(pending, agentId);
  const { entryHashes: _omit, ...batch } = pending;
  await log.recordAnchor({ ...batch, network: anchorer.network, txHash, explorerUrl, anchoredAt: new Date().toISOString() });
  return txHash;
}

/** Poll receipts for submissions that do not have one yet. */
export async function refreshReceipts(d: Pick<RunDeps, "state" | "sink" | "log">): Promise<number> {
  if (!d.sink.receipt) return 0;
  let n = 0;
  for (const s of await d.state.submissions()) {
    if (s.receipt || !s.remoteId || s.dryRun) continue;
    const r = await d.sink.receipt(s.remoteId);
    if (!r) continue;
    const receipt = { verdict: r.verdict, rationale: r.rationale, reward: r.reward, raw: r.raw, checkedAt: new Date().toISOString() };
    await d.state.addSubmission({ ...s, receipt });
    await d.log.append("evidence.receipt", { evidenceId: s.evidenceId, marketId: s.marketId, verdict: r.verdict, reward: r.reward, rationale: r.rationale });
    n++;
  }
  return n;
}

const short = (q: string) => (q.length > 70 ? `${q.slice(0, 69)}…` : q);

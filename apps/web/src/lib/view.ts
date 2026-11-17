import type { LogEntry } from "@oracle-scout/ledger";

/** Slim entry for the client: everything needed to recompute hashes, plus a one-line summary. */
export interface ViewEntry {
  v: 1;
  seq: number;
  ts: string;
  kind: LogEntry["kind"];
  actor: string;
  payloadHash: string;
  prevHash: string;
  entryHash: string;
  summary: string;
  dryRun?: boolean;
}

type P = Record<string, unknown>;

export function summarize(e: LogEntry): string {
  const p = (e.payload ?? {}) as P;
  switch (e.kind) {
    case "run.start":
      return `Run started${p.dryRun ? " (dry run: nothing sent to Delphi)" : ""}`;
    case "run.end": {
      const s = (p.summary ?? {}) as P;
      return `Run finished: ${s.markets ?? 0} markets seen, ${s.planned ?? 0} resolvable, ${s.submitted ?? 0} submitted, ${s.abstained ?? 0} abstained`;
    }
    case "market.triage":
      return `Triage: ${(p.planned as unknown[] | undefined)?.length ?? 0} of ${p.seen ?? 0} markets can be settled from primary data`;
    case "source.fetch":
      return `Fetched ${p.source} (${p.observations ?? "?"} observations)`;
    case "analysis":
      return p.decision === "abstain" ? `Abstained: ${p.reason}` : `Computed odds: ${String(p.method ?? "").split(":")[0]}`;
    case "evidence.created":
      return String(p.claim ?? "Evidence created");
    case "evidence.submitted":
      return `${p.dryRun ? "Dry-run submission" : "Submitted to Delphi"}: ${p.stance} on ${String(p.marketId).slice(0, 18)}`;
    case "evidence.receipt":
      return `Judge verdict: ${p.verdict ?? "?"}${p.reward !== undefined ? `, reward ${p.reward}` : ""}`;
    case "guardrail.block":
      return `Blocked by ${p.rule}: ${p.reason}`;
    case "oversight":
      return `Human oversight: ${p.action}${p.reason ? ` (${p.reason})` : ""}`;
    case "anchor":
      return `Anchored entries ${p.fromSeq}–${p.toSeq} on Concordium`;
    case "pack.sold":
      return `Evidence pack sold for ${p.amount} microCCD`;
    case "error":
      return `Error at ${p.stage}: ${String(p.message ?? "").slice(0, 120)}`;
    default:
      return e.kind;
  }
}

export function toView(entries: LogEntry[]): ViewEntry[] {
  return entries.map((e) => ({
    v: e.v,
    seq: e.seq,
    ts: e.ts,
    kind: e.kind,
    actor: e.actor,
    payloadHash: e.payloadHash,
    prevHash: e.prevHash,
    entryHash: e.entryHash,
    summary: summarize(e),
    dryRun: Boolean((e.payload as P | undefined)?.dryRun),
  }));
}

export const short = (h: string, n = 8) => (h.length > 2 * n ? `${h.slice(0, n)}…${h.slice(-4)}` : h);
export const ccd = (micro: string | number | bigint) => `${(Number(micro) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 })} CCD`;
export const when = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";

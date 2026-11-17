import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EvidenceItem, Market } from "@oracle-scout/evidence";
import type { AgentConfig } from "./config.js";
import type { SubmissionRecord } from "./state.js";

export type GuardVerdict = { ok: true } | { ok: false; rule: string; reason: string };

/** Kill switch: a file `<dataDir>/KILL` or OS_KILL=1 stops all outbound submissions immediately. */
export function killSwitch(dataDir: string, env = process.env): { engaged: boolean; reason?: string } {
  if (env.OS_KILL === "1") return { engaged: true, reason: "OS_KILL=1" };
  const f = join(dataDir, "KILL");
  if (existsSync(f)) return { engaged: true, reason: readFileSync(f, "utf8").trim() || "kill file present" };
  return { engaged: false };
}

/**
 * Hard limits checked right before anything leaves the machine. They are deliberately
 * dumb and independent of the evidence logic, so a bug upstream cannot spam a market.
 */
export function checkGuardrails(args: {
  item: EvidenceItem;
  market: Market;
  history: SubmissionRecord[];
  submittedThisRun: number;
  cfg: AgentConfig;
  now: Date;
}): GuardVerdict {
  const { item, market, history, submittedThisRun, cfg, now } = args;
  const L = cfg.limits;
  const ks = killSwitch(cfg.dataDir);
  if (ks.engaged) return { ok: false, rule: "kill-switch", reason: ks.reason! };
  if (submittedThisRun >= L.maxPerRun) return { ok: false, rule: "max-per-run", reason: `already ${submittedThisRun} this run` };
  const dayAgo = now.getTime() - 86_400_000;
  const today = history.filter((h) => Date.parse(h.submittedAt) > dayAgo).length;
  if (today >= L.maxPerDay) return { ok: false, rule: "max-per-day", reason: `${today} in the last 24h` };
  const onMarket = history.filter((h) => h.marketId === market.id);
  if (onMarket.length >= L.maxPerMarket) return { ok: false, rule: "max-per-market", reason: `${onMarket.length} already on this market` };
  const opposite = onMarket.find((h) => h.stance !== item.stance);
  if (opposite) return { ok: false, rule: "stance-lock", reason: `already argued ${opposite.stance} here; both sides cancel out` };
  const cutoff = market.evidenceCutoff ?? market.closeTime;
  if (Date.parse(cutoff) - now.getTime() < L.cutoffBufferMin * 60_000) return { ok: false, rule: "cutoff", reason: `evidence cutoff ${cutoff} too close` };
  if (item.facts.length === 0 || item.links.length === 0) return { ok: false, rule: "sourced", reason: "no sourced facts" };
  return { ok: true };
}

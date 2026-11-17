import { createHash } from "node:crypto";
import {
  dailyVolatility,
  daysBetween,
  nextPrintOdds,
  priceThresholdOdds,
  trendSummary,
  trendThresholdOdds,
  type ThresholdOdds,
} from "./analysis.js";
import type { Market, ResolverPlan } from "./market.js";
import { fetchSeries } from "./sources.js";
import { nullRecorder, type HttpGet, type Observation, type Recorder, type Series } from "./types.js";

export interface EvidenceSourceRef {
  publisher: string;
  url: string;
  dataUrl: string;
  retrievedAt: string;
  contentHash: string;
  /** Verbatim fragment of the response (the "quote"). */
  quote?: string;
}

export interface EvidenceFact {
  statement: string;
  asOf: string;
  value?: number;
  unit?: string;
  source: EvidenceSourceRef;
}

export type Stance = "YES" | "NO";

export interface EvidenceItem {
  id: string;
  marketId: string;
  question: string;
  stance: Stance;
  /** Our model's P(YES). */
  probability: number;
  marketYesPrice?: number;
  headline: string;
  /** Ready-to-submit short note (plain text). */
  note: string;
  facts: EvidenceFact[];
  method: string;
  computed: Record<string, number | string>;
  plan: ResolverPlan;
  links: string[];
  createdAt: string;
  /** Stable across re-runs on the same data: (market, series, latest observation, stance). */
  fingerprint: string;
}

export type MineResult =
  | { status: "evidence"; item: EvidenceItem }
  | { status: "abstain"; reason: string; probability?: number };

export interface DecisionPolicy {
  /** Only take a side when P(YES) >= yesAt or <= noAt. */
  yesAt: number;
  noAt: number;
  /** When the market price is known, also require |P - price| >= minEdge (otherwise we tell the forecaster nothing new). */
  minEdge: number;
}

export const DEFAULT_POLICY: DecisionPolicy = { yesAt: 0.8, noAt: 0.2, minEdge: 0.1 };

export interface MineDeps {
  http: HttpGet;
  now?: () => Date;
  recorder?: Recorder;
  policy?: DecisionPolicy;
}

const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: Math.min(d, 2) });
const pct = (p: number) => `${(p * 100).toFixed(p < 0.01 || p > 0.99 ? 1 : 0)}%`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function sourceRef(series: Series, quote?: string): EvidenceSourceRef {
  const p = series.provenance;
  return { publisher: p.publisher, url: p.sourceUrl, dataUrl: p.dataUrl, retrievedAt: p.retrievedAt, contentHash: p.contentHash, quote };
}

async function load(plan: ResolverPlan, deps: MineDeps): Promise<Series> {
  const rec = deps.recorder ?? nullRecorder;
  const tryRef = async (ref: ResolverPlan["ref"]) => {
    const s = await fetchSeries(ref, deps.http);
    await rec.record("source.fetch", {
      source: `${ref.source}:${ref.id}`,
      url: s.provenance.dataUrl,
      contentHash: s.provenance.contentHash,
      observations: s.observations.length,
      latest: s.observations[s.observations.length - 1],
    });
    return s;
  };
  try {
    return await tryRef(plan.ref);
  } catch (err) {
    if (plan.kind === "next-print" && plan.fallback) {
      await rec.record("error", { stage: "fetch", ref: plan.ref, message: (err as Error).message, recovery: "fallback series" });
      return tryRef(plan.fallback);
    }
    throw err;
  }
}

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "November CPI", "CPI for October 2026" -> YYYY-MM-01 of the reference period, if stated. */
export function referencePeriod(question: string, closeTime: string): string | null {
  const m = new RegExp(String.raw`\b(${MONTH_NAMES.join("|")})\b(?:\s+(\d{4}))?`, "i").exec(question);
  if (!m) return null;
  // A month followed by a day number is a deadline, not a reference period.
  if (/^\s*\d{1,2}(?!\d)/.test(question.slice(m.index + m[1]!.length))) return null;
  const mi = MONTH_NAMES.indexOf(m[1]!.toLowerCase());
  let year = m[2] ? Number(m[2]) : new Date(closeTime).getUTCFullYear();
  if (!m[2] && mi > new Date(closeTime).getUTCMonth()) year -= 1;
  return `${year}-${String(mi + 1).padStart(2, "0")}-01`;
}

/** Fetch primary data for a planned market, compute the odds, and either produce one evidence item or abstain. */
export async function mine(market: Market, plan: ResolverPlan, deps: MineDeps): Promise<MineResult> {
  const now = (deps.now ?? (() => new Date()))();
  const rec = deps.recorder ?? nullRecorder;
  const policy = deps.policy ?? DEFAULT_POLICY;
  if (Date.parse(plan.deadline) <= now.getTime()) return { status: "abstain", reason: "deadline already passed" };

  const series = await load(plan, deps);
  const trend = trendSummary(series);
  const latest = trend.latest;
  const days = daysBetween(now.toISOString(), plan.deadline);
  const facts: EvidenceFact[] = [];
  let odds: ThresholdOdds;
  let pYes: number;
  let framing: string;

  facts.push({
    statement: `${series.title}: ${fmt(latest.value, 4)}${series.unit && series.unit !== "index" ? ` ${series.unit}` : ""} as of ${latest.date}`,
    asOf: latest.date,
    value: latest.value,
    unit: series.unit,
    source: sourceRef(series, latest.raw),
  });

  if (plan.kind === "price") {
    const vol = dailyVolatility(series, 60);
    const move = (plan.threshold / latest.value - 1) * 100;
    const alreadyThere = plan.comparator === "above" ? latest.value >= plan.threshold : latest.value <= plan.threshold;
    odds = priceThresholdOdds({ spot: latest.value, threshold: plan.threshold, dailyVol: vol, days, mode: plan.mode });
    if (plan.mode === "close") pYes = plan.comparator === "above" ? odds.probability : 1 - odds.probability;
    else pYes = alreadyThere ? 0.97 : odds.probability;
    framing =
      `${plan.label} needs ${move >= 0 ? "+" : ""}${move.toFixed(1)}% (to ${fmt(plan.threshold)}) ` +
      `${plan.mode === "close" ? `to ${plan.comparator === "above" ? "close above" : "close below"} it at` : "to touch it before"} ${plan.deadline.slice(0, 10)}, ${days.toFixed(1)} days away. ` +
      `60-day realised volatility is ${(vol * 100).toFixed(2)}%/day (${(vol * Math.sqrt(365) * 100).toFixed(0)}% annualised).`;
    const wk = trend.changes.find((c) => c.periods === 7);
    if (wk) {
      facts.push({
        statement: `7-day change: ${wk.pct >= 0 ? "+" : ""}${wk.pct.toFixed(2)}% (from ${fmt(wk.from.value)} on ${wk.from.date})`,
        asOf: latest.date,
        source: sourceRef(series, wk.from.raw),
      });
    }
  } else if (plan.kind === "next-print") {
    const refPeriod = referencePeriod(market.question, market.closeTime);
    const printed = refPeriod ? series.observations.find((o) => o.date.slice(0, 7) === refPeriod.slice(0, 7)) : undefined;
    const nextExpected = nextMonth(latest.date);
    if (printed) {
      const value = transformValue(series.observations, printed, plan.transform);
      const yes = plan.comparator === "above" ? value > plan.threshold : value < plan.threshold;
      pYes = yes ? 0.99 : 0.01;
      odds = { probability: pYes, method: "already published by the statistical agency", inputs: { referencePeriod: refPeriod!, value: +value.toFixed(3) } };
      framing = `The ${refPeriod!.slice(0, 7)} figure is already published: ${plan.transform === "level" ? "" : `${plan.transform.toUpperCase()} `}${value.toFixed(2)}${plan.transform === "level" ? "" : "%"} vs threshold ${plan.threshold}.`;
      facts.push({ statement: framing, asOf: printed.date, value, source: sourceRef(series, printed.raw) });
    } else if (refPeriod && refPeriod.slice(0, 7) !== nextExpected.slice(0, 7)) {
      return { status: "abstain", reason: `question is about ${refPeriod.slice(0, 7)}, but the next release covers ${nextExpected.slice(0, 7)}` };
    } else {
      const o = nextPrintOdds({ series, transform: plan.transform, threshold: plan.threshold, direction: plan.comparator });
      odds = o;
      pYes = o.probability;
      const currentYoy = transformValue(series.observations, latest, "yoy");
      framing =
        `Latest ${latest.date.slice(0, 7)} reading gives ${plan.transform === "level" ? `${fmt(latest.value)}` : `y/y ${currentYoy.toFixed(2)}%`}. ` +
        `For the ${nextExpected.slice(0, 7)} print to come in ${plan.comparator} ${plan.threshold}${plan.transform === "level" ? "" : "%"}, the index must move ${o.requiredMoMPct >= 0 ? "+" : ""}${o.requiredMoMPct.toFixed(2)}% m/m; ` +
        `that happened in ${o.hits} of the last ${o.of} months.`;
      const base = series.observations[series.observations.length - 12];
      if (base && plan.transform === "yoy") {
        facts.push({ statement: `Base month for next y/y comparison: ${fmt(base.value, 3)} on ${base.date}`, asOf: base.date, value: base.value, source: sourceRef(series, base.raw) });
      }
    }
  } else {
    const periodDays = { intraday: 1 / 24, daily: 1, weekly: 7, monthly: 30.4, quarterly: 91, annual: 365, irregular: 30 }[series.frequency];
    const periodsAhead = Math.max(days / periodDays, 0.5);
    odds = trendThresholdOdds({ series, threshold: plan.threshold, periodsAhead, window: trend.window });
    pYes = plan.comparator === "above" ? odds.probability : 1 - odds.probability;
    framing =
      `Over the last ${trend.window} observations the series is ${trend.direction} (${trend.slopePerPeriod >= 0 ? "+" : ""}${fmt(trend.slopePerPeriod, 4)} per ${series.frequency.replace(/ly$/, "")}); ` +
      `extrapolated to ${plan.deadline.slice(0, 10)} it reaches ${fmt(Number(odds.inputs.projected), 3)} against a threshold of ${fmt(plan.threshold, 3)}.`;
  }

  const computed = { ...odds.inputs, pYes: +pYes.toFixed(4), daysToDeadline: +days.toFixed(2) };
  await rec.record("analysis", { marketId: market.id, method: odds.method, computed });

  let stance: Stance | null = pYes >= policy.yesAt ? "YES" : pYes <= policy.noAt ? "NO" : null;
  if (!stance) return { status: "abstain", reason: `not decisive: P(YES)=${pct(pYes)} (needs ≥${pct(policy.yesAt)} or ≤${pct(policy.noAt)})`, probability: pYes };
  if (market.yesPrice !== undefined && Math.abs(pYes - market.yesPrice) < policy.minEdge) {
    return { status: "abstain", reason: `market already prices this: ${pct(market.yesPrice)} vs our ${pct(pYes)}`, probability: pYes };
  }

  const headline = `Primary data points to ${stance}: ${odds.method.split(":")[0]} gives P(YES) ≈ ${pct(pYes)}`;
  const facts0 = facts[0]!;
  const note = [
    `${headline}.`,
    `• ${facts0.statement} (${facts0.source.publisher}; raw: "${truncate(facts0.source.quote ?? "", 90)}").`,
    ...facts.slice(1).map((f) => `• ${f.statement}.`),
    `• ${framing}`,
    `• Method: ${odds.method}.${market.yesPrice !== undefined ? ` Market currently implies ${pct(market.yesPrice)}.` : ""}`,
    `Source: ${facts0.source.dataUrl} (retrieved ${facts0.source.retrievedAt.slice(0, 16)}Z, sha256 ${facts0.source.contentHash.slice(0, 12)}…).`,
  ].join("\n");

  const fingerprint = sha([market.id, `${plan.ref.source}:${plan.ref.id}`, latest.date, stance].join("|"));
  const createdAt = now.toISOString();
  const item: EvidenceItem = {
    id: sha(`${fingerprint}|${createdAt}`).slice(0, 24),
    marketId: market.id,
    question: market.question,
    stance,
    probability: pYes,
    marketYesPrice: market.yesPrice,
    headline,
    note,
    facts,
    method: odds.method,
    computed,
    plan,
    links: [...new Set(facts.flatMap((f) => [f.source.url, f.source.dataUrl]))],
    createdAt,
    fingerprint,
  };
  await rec.record("evidence.created", { evidenceId: item.id, marketId: market.id, stance, probability: pYes, claim: headline, fingerprint });
  return { status: "evidence", item };
}

function nextMonth(date: string): string {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function transformValue(obs: Observation[], at: Observation, t: "yoy" | "mom" | "level"): number {
  if (t === "level") return at.value;
  const i = obs.indexOf(at);
  const back = obs[i - (t === "yoy" ? 12 : 1)];
  return back ? (at.value / back.value - 1) * 100 : NaN;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

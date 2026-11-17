import type { SeriesRef } from "./types.js";

/** A yes/no forecasting question, independent of any one platform (Delphi, Cortensor, Polymarket...). */
export interface Market {
  id: string;
  question: string;
  description?: string;
  /** When the question resolves / trading closes (ISO). */
  closeTime: string;
  /** Last moment evidence is accepted, if the platform has one (ISO). */
  evidenceCutoff?: string;
  /** Current implied probability of YES, 0..1, if known. */
  yesPrice?: number;
  category?: string;
  url?: string;
  extra?: Record<string, unknown>;
}

/** Extra series to try, in order, if the primary one cannot be fetched. */
type WithFallback = { fallback?: SeriesRef | SeriesRef[] };

export type ResolverPlan = WithFallback &
  (
  | {
      kind: "price";
      ref: SeriesRef;
      label: string;
      threshold: number;
      comparator: "above" | "below";
      mode: "close" | "touch";
      deadline: string;
    }
  | {
      kind: "next-print";
      ref: SeriesRef;
      label: string;
      transform: "yoy" | "mom" | "level";
      threshold: number;
      comparator: "above" | "below";
      deadline: string;
    }
  | {
      kind: "trend-level";
      ref: SeriesRef;
      label: string;
      threshold: number;
      comparator: "above" | "below";
      deadline: string;
    });

export interface PlanResult {
  plan: ResolverPlan | null;
  confidence: number;
  reason: string;
}

const CRYPTO: Record<string, string> = {
  bitcoin: "BTC-USD",
  btc: "BTC-USD",
  ethereum: "ETH-USD",
  ether: "ETH-USD",
  eth: "ETH-USD",
  solana: "SOL-USD",
  sol: "SOL-USD",
  xrp: "XRP-USD",
  dogecoin: "DOGE-USD",
  doge: "DOGE-USD",
  cardano: "ADA-USD",
  ada: "ADA-USD",
  avalanche: "AVAX-USD",
  avax: "AVAX-USD",
  chainlink: "LINK-USD",
  link: "LINK-USD",
  litecoin: "LTC-USD",
  ltc: "LTC-USD",
};

/** Macro questions we can answer from an official series. Order matters: more specific first. */
const MACRO: {
  match: RegExp;
  label: string;
  ref: SeriesRef;
  fallback?: SeriesRef;
  transform: "yoy" | "mom" | "level";
  kind: "next-print" | "trend-level";
  unitPct: boolean;
}[] = [
  {
    match: /\bcore\b.*\b(cpi|inflation)\b|\b(cpi|inflation)\b.*\bcore\b/i,
    label: "US core CPI (NSA, all items less food and energy)",
    ref: { source: "bls", id: "CUUR0000SA0L1E" },
    fallback: { source: "fred", id: "CPILFENS" },
    transform: "yoy",
    kind: "next-print",
    unitPct: true,
  },
  {
    match: /\b(us|u\.s\.|united states|american)?\s*(cpi|inflation|consumer price)/i,
    label: "US CPI-U (NSA, all items)",
    ref: { source: "bls", id: "CUUR0000SA0" },
    fallback: { source: "fred", id: "CPIAUCNS" },
    transform: "yoy",
    kind: "next-print",
    unitPct: true,
  },
  {
    match: /\bunemployment rate\b/i,
    label: "US unemployment rate (SA)",
    ref: { source: "bls", id: "LNS14000000" },
    fallback: { source: "fred", id: "UNRATE" },
    transform: "level",
    kind: "next-print",
    unitPct: true,
  },
  {
    match: /\b10[- ]?year\b.*\b(treasury|yield)/i,
    label: "US 10-year Treasury constant-maturity yield",
    ref: { source: "fred", id: "DGS10", params: { unit: "%" } },
    transform: "level",
    kind: "trend-level",
    unitPct: true,
  },
  {
    match: /\b(gas|gasoline) price/i,
    label: "US regular gasoline retail price (weekly)",
    ref: { source: "fred", id: "GASREGW", params: { unit: "USD/gal" } },
    transform: "level",
    kind: "trend-level",
    unitPct: false,
  },
  {
    match: /\b(national|federal|public) debt\b/i,
    label: "US total public debt outstanding",
    ref: { source: "treasury", id: "v2/accounting/od/debt_to_penny", params: { field: "tot_pub_debt_out_amt" } },
    transform: "level",
    kind: "trend-level",
    unitPct: false,
  },
];

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

/** Parse "$100k", "$1.2m", "100,000", "3.1%", "$41 trillion". Returns the first number after a comparator word. */
export function parseThreshold(text: string): { value: number; comparator: "above" | "below"; pct: boolean } | null {
  const re = new RegExp(
    String.raw`\b(above|over|exceed(?:s|ing)?|greater than|more than|higher than|at least|reach(?:es)?|hit(?:s)?|top(?:s)?|surpass(?:es)?|break(?:s)?|below|under|less than|lower than|beneath|drop(?:s)? (?:to|below)|fall(?:s)? (?:to|below)|at or above|at or below)\s+\$?\s*([\d][\d,]*(?:\.\d+)?)\s*(k|thousand|mn|million|m|bn|billion|b|tn|trillion|t|%|percent)?(?![a-z])`,
    "i",
  );
  const m = re.exec(text);
  if (!m) return null;
  const word = m[1]!.toLowerCase();
  const below = /below|under|less|lower|beneath|drop|fall/.test(word);
  let value = Number(m[2]!.replace(/,/g, ""));
  const suffix = (m[3] ?? "").toLowerCase();
  const mult: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, tn: 1e12, trillion: 1e12 };
  if (mult[suffix]) value *= mult[suffix]!;
  return { value, comparator: below ? "below" : "above", pct: suffix === "%" || suffix === "percent" };
}

/** Find an explicit deadline in the text ("by December 31, 2026", "on 5 Dec", "end of 2026"); else the market close. */
export function parseDeadline(text: string, fallbackIso: string): string {
  const year = new Date(fallbackIso).getUTCFullYear();
  const md = new RegExp(String.raw`\b(${MONTHS})\b\.?\s+(\d{1,2})(?!\d)(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?`, "i").exec(text);
  const dm = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(${MONTHS})\b\.?(?:,?\s+(\d{4}))?`, "i").exec(text);
  const hit = md ? { mon: md[1]!, day: md[2]!, yr: md[3] } : dm ? { mon: dm[2]!, day: dm[1]!, yr: dm[3] } : null;
  if (hit) {
    const mi = monthIndex(hit.mon);
    return new Date(Date.UTC(Number(hit.yr ?? year), mi, Number(hit.day), 23, 59, 59)).toISOString();
  }
  const eoy = /\b(?:end of|by end of|before)\s+(\d{4})\b/i.exec(text);
  if (eoy) {
    const y = Number(eoy[1]);
    return /before/i.test(eoy[0]) ? new Date(Date.UTC(y - 1, 11, 31, 23, 59, 59)).toISOString() : new Date(Date.UTC(y, 11, 31, 23, 59, 59)).toISOString();
  }
  return fallbackIso;
}

function monthIndex(s: string): number {
  return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(s.slice(0, 3).toLowerCase());
}

/**
 * Map a market to a primary-data resolver plan, or explain why we abstain.
 * Deliberately conservative: anything ambiguous returns plan=null. Picking fewer, sharper
 * markets beats covering many (edition 1's winner picked 10 of ~50).
 */
export function planMarket(market: Market, overrides: Record<string, ResolverPlan> = {}): PlanResult {
  if (overrides[market.id]) return { plan: overrides[market.id]!, confidence: 1, reason: "human-curated plan" };
  const text = `${market.question} ${market.description ?? ""}`;
  const q = market.question;
  const threshold = parseThreshold(q) ?? parseThreshold(text);
  const deadline = parseDeadline(q, market.closeTime);

  const coinWord = Object.keys(CRYPTO).find((w) => new RegExp(String.raw`\b${w}\b`, "i").test(q));
  if (coinWord && threshold && !threshold.pct) {
    const touch = /\b(reach|hit|touch|top|surpass|break|drop|fall|dip|sink|at any (point|time)|trade above|trade below)\b/i.test(q);
    return {
      plan: {
        kind: "price",
        ref: { source: "coinbase", id: CRYPTO[coinWord]! },
        fallback: [
          { source: "kraken", id: CRYPTO[coinWord]! },
          { source: "coingecko", id: CRYPTO[coinWord]! },
        ],
        label: CRYPTO[coinWord]!,
        threshold: threshold.value,
        comparator: threshold.comparator,
        mode: touch ? "touch" : "close",
        deadline,
      },
      confidence: touch || /\bclose\b|\bon\b|\bprice\b/i.test(q) ? 0.85 : 0.65,
      reason: `crypto price threshold (${touch ? "touch" : "close"})`,
    };
  }

  for (const m of MACRO) {
    if (!m.match.test(q)) continue;
    if (!threshold) return { plan: null, confidence: 0, reason: `${m.label}: no numeric threshold found` };
    if (m.unitPct !== threshold.pct && m.transform !== "level") {
      return { plan: null, confidence: 0, reason: `${m.label}: threshold unit unclear` };
    }
    const transform = m.transform === "yoy" && /month[- ]over[- ]month|\bm\/m\b|\bmom\b|monthly/i.test(q) ? "mom" : m.transform;
    const plan: ResolverPlan =
      m.kind === "next-print"
        ? { kind: "next-print", ref: m.ref, fallback: m.fallback, label: m.label, transform, threshold: threshold.value, comparator: threshold.comparator, deadline }
        : { kind: "trend-level", ref: m.ref, label: m.label, threshold: threshold.value, comparator: threshold.comparator, deadline };
    return { plan, confidence: 0.75, reason: `macro series match: ${m.label}` };
  }
  return { plan: null, confidence: 0, reason: "no primary data series maps to this question" };
}

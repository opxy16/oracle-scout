import type { Frequency, Observation, Series } from "./types.js";

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export function logReturns(obs: Observation[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < obs.length; i++) {
    const a = obs[i - 1]!.value;
    const b = obs[i]!.value;
    if (a > 0 && b > 0) out.push(Math.log(b / a));
  }
  return out;
}

/** Ordinary least squares slope of value against period index. */
export function olsSlope(values: number[]): { slope: number; intercept: number; residualSd: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0, residualSd: 0 };
  const xm = (n - 1) / 2;
  const ym = mean(values);
  let sxy = 0;
  let sxx = 0;
  values.forEach((y, x) => {
    sxy += (x - xm) * (y - ym);
    sxx += (x - xm) ** 2;
  });
  const slope = sxy / sxx;
  const intercept = ym - slope * xm;
  const resid = values.map((y, x) => y - (intercept + slope * x));
  return { slope, intercept, residualSd: stdev(resid) };
}

export const PERIODS_PER_YEAR: Record<Frequency, number> = {
  intraday: 365 * 24,
  daily: 365,
  weekly: 52,
  monthly: 12,
  quarterly: 4,
  annual: 1,
  irregular: 12,
};

export interface TrendSummary {
  latest: Observation;
  previous?: Observation;
  changes: { periods: number; from: Observation; abs: number; pct: number }[];
  slopePerPeriod: number;
  /** Direction of the last `window` observations by OLS. */
  direction: "rising" | "falling" | "flat";
  /** z-score of the latest value against the window. */
  zLatest: number;
  window: number;
}

export function trendSummary(series: Series, opts: { window?: number; lags?: number[] } = {}): TrendSummary {
  const obs = series.observations;
  const window = Math.min(opts.window ?? defaultWindow(series.frequency), obs.length);
  const lags = opts.lags ?? defaultLags(series.frequency);
  const latest = obs[obs.length - 1]!;
  const recent = obs.slice(-window).map((o) => o.value);
  const { slope } = olsSlope(recent);
  const sd = stdev(recent);
  const rel = Math.abs(slope) * window / (Math.abs(mean(recent)) || 1);
  return {
    latest,
    previous: obs[obs.length - 2],
    changes: lags
      .filter((l) => l < obs.length)
      .map((periods) => {
        const from = obs[obs.length - 1 - periods]!;
        return { periods, from, abs: latest.value - from.value, pct: from.value ? (latest.value / from.value - 1) * 100 : NaN };
      }),
    slopePerPeriod: slope,
    direction: rel < 0.005 ? "flat" : slope > 0 ? "rising" : "falling",
    zLatest: sd ? (latest.value - mean(recent)) / sd : 0,
    window,
  };
}

function defaultWindow(f: Frequency): number {
  return { intraday: 48, daily: 30, weekly: 26, monthly: 24, quarterly: 12, annual: 10, irregular: 20 }[f];
}

function defaultLags(f: Frequency): number[] {
  return { intraday: [1, 24], daily: [1, 7, 30], weekly: [1, 4, 13], monthly: [1, 3, 12], quarterly: [1, 4], annual: [1, 5], irregular: [1] }[f];
}

export interface ThresholdOdds {
  probability: number;
  method: string;
  inputs: Record<string, number | string>;
}

/**
 * P(price is above `threshold`) for a lognormal random walk.
 *  mode "close": at the deadline.   mode "touch": at any point before it (reflection principle).
 * Drift defaults to zero: we do not forecast direction, only how far volatility can carry it.
 */
export function priceThresholdOdds(args: {
  spot: number;
  threshold: number;
  dailyVol: number;
  days: number;
  mode: "close" | "touch";
  dailyDrift?: number;
}): ThresholdOdds {
  const { spot, threshold, dailyVol, days, mode, dailyDrift = 0 } = args;
  const t = Math.max(days, 1e-6);
  const s = dailyVol * Math.sqrt(t);
  const dist = Math.log(threshold / spot);
  const inputs = { spot, threshold, dailyVolPct: +(dailyVol * 100).toFixed(3), days: +t.toFixed(2), mode };
  if (s === 0) return { probability: spot > threshold ? 1 : 0, method: "deterministic", inputs };
  if (mode === "close") {
    // probability = P(price above threshold at the deadline)
    const pAbove = 1 - normCdf((dist - (dailyDrift - (dailyVol * dailyVol) / 2) * t) / s);
    return { probability: clamp(pAbove), method: "lognormal terminal distribution, zero drift", inputs };
  }
  // probability = P(price touches the threshold, from whichever side it is on, before the deadline).
  // For a driftless walk, P(running max/min crosses the barrier) = 2 * P(ending beyond it).
  const touch = dist === 0 ? 1 : Math.min(1, 2 * (1 - normCdf(Math.abs(dist) / s)));
  return { probability: clamp(touch), method: "reflection principle (barrier touch), zero drift", inputs };
}

/**
 * Odds that the NEXT print of a monthly index series crosses a threshold, from base effects:
 * compute the month-on-month change the next print needs, then count how often the
 * last `lookback` months delivered at least that. Laplace-smoothed so it never says 0 or 1.
 */
export function nextPrintOdds(args: {
  series: Series;
  transform: "yoy" | "mom" | "level";
  threshold: number;
  direction: "above" | "below";
  lookback?: number;
  /** Treat values equal to threshold as above? Markets usually say "above" = strictly greater. */
  inclusive?: boolean;
}): ThresholdOdds & { requiredMoMPct: number; hits: number; of: number } {
  const { series, transform, threshold, direction, lookback = 36, inclusive = false } = args;
  const obs = series.observations;
  const last = obs[obs.length - 1]!.value;
  const moms = obs.slice(-lookback - 1).map((o, i, a) => (i ? (o.value / a[i - 1]!.value - 1) * 100 : NaN)).slice(1);
  let requiredLevel: number;
  if (transform === "yoy") {
    const base = obs[obs.length - 12]; // the month 11 back becomes the YoY base for next print
    if (!base) throw new Error("nextPrintOdds: need 12+ observations for yoy");
    requiredLevel = base.value * (1 + threshold / 100);
  } else if (transform === "mom") {
    requiredLevel = last * (1 + threshold / 100);
  } else {
    requiredLevel = threshold;
  }
  const requiredMoMPct = (requiredLevel / last - 1) * 100;
  const hitsAbove = moms.filter((m) => (inclusive ? m >= requiredMoMPct : m > requiredMoMPct)).length;
  const hits = direction === "above" ? hitsAbove : moms.length - hitsAbove;
  const probability = (hits + 1) / (moms.length + 2);
  return {
    probability,
    requiredMoMPct,
    hits,
    of: moms.length,
    method: `base effects: next print needs m/m ${requiredMoMPct >= 0 ? "≥" : "≤"} ${requiredMoMPct.toFixed(2)}%; empirical frequency over last ${moms.length} months (Laplace-smoothed)`,
    inputs: { last, requiredLevel: +requiredLevel.toFixed(4), requiredMoMPct: +requiredMoMPct.toFixed(3), lookback: moms.length },
  };
}

/** OLS of y on x (x in any unit, e.g. days). */
export function olsXY(xs: number[], ys: number[]): { slope: number; intercept: number; residualSd: number } {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, residualSd: 0 };
  const xm = mean(xs);
  const ym = mean(ys);
  let sxy = 0;
  let sxx = 0;
  xs.forEach((x, i) => {
    sxy += (x - xm) * (ys[i]! - ym);
    sxx += (x - xm) ** 2;
  });
  const slope = sxx ? sxy / sxx : 0;
  const intercept = ym - slope * xm;
  return { slope, intercept, residualSd: stdev(ys.map((y, i) => y - (intercept + slope * xs[i]!))) };
}

/**
 * Generic level series: fit the trend against calendar time (so business-day or irregular
 * series are handled correctly), extrapolate to the deadline, use residual spread as uncertainty.
 */
export function trendThresholdOdds(args: { series: Series; threshold: number; asOf: string; deadline: string; window?: number }): ThresholdOdds {
  const obs = args.series.observations.slice(-(args.window ?? 24));
  const t0 = Date.parse(obs[0]!.date);
  const xs = obs.map((o) => (Date.parse(o.date) - t0) / 86_400_000);
  const { slope, intercept, residualSd } = olsXY(xs, obs.map((o) => o.value));
  const span = xs[xs.length - 1]! || 1;
  const tDeadline = (Date.parse(args.deadline) - t0) / 86_400_000;
  const daysAhead = Math.max(tDeadline - span, 0);
  const projected = intercept + slope * tDeadline;
  const sd = Math.max(residualSd * Math.sqrt(1 + daysAhead / span), 1e-9);
  // Trend extrapolation ignores regime changes, so never claim more than 97% either way.
  return {
    probability: Math.min(0.97, Math.max(0.03, 1 - normCdf((args.threshold - projected) / sd))),
    method: "OLS trend extrapolation with residual spread",
    inputs: { projected: +projected.toFixed(4), sd: +sd.toFixed(4), slopePerDay: +slope.toFixed(5), daysAhead: +daysAhead.toFixed(2), windowDays: +span.toFixed(1) },
  };
}

export function dailyVolatility(series: Series, lookback = 60): number {
  return stdev(logReturns(series.observations.slice(-lookback - 1)));
}

function clamp(p: number): number {
  return Math.min(0.999, Math.max(0.001, p));
}

export function daysBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000;
}

import { describe, expect, it } from "vitest";
import {
  checkNovelty,
  fakeHttp,
  mine,
  nextPrintOdds,
  normCdf,
  parseDeadline,
  parseThreshold,
  planMarket,
  priceThresholdOdds,
  referencePeriod,
  type Market,
  type Recorder,
  type Series,
  guessFrequency,
  trendThresholdOdds,
} from "../src/index.js";

const NOW = new Date("2026-11-20T12:00:00Z");

/** 90 daily candles around $64k with ~1.5% daily noise (deterministic). */
function candles(): string {
  const rows: number[][] = [];
  let p = 64000;
  for (let i = 0; i < 90; i++) {
    p *= 1 + 0.015 * Math.sin(i * 1.7);
    const t = Date.parse("2026-08-23T00:00:00Z") / 1000 + i * 86400;
    rows.push([t, p * 0.98, p * 1.02, p, p, 1000]);
  }
  return JSON.stringify(rows.reverse());
}

/** Monthly CPI-like index rising ~0.25%/month, FRED CSV format. */
function cpiCsv(months = 48, mom = 0.0025): string {
  const lines = ["observation_date,CPIAUCNS"];
  let v = 300;
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(2022, 11 + i, 1)).toISOString().slice(0, 10);
    lines.push(`${d},${v.toFixed(3)}`);
    v *= 1 + mom + (i % 3 === 0 ? 0.001 : 0);
  }
  return lines.join("\n");
}

const market = (q: string, extra: Partial<Market> = {}): Market => ({ id: "m1", question: q, closeTime: "2026-12-31T23:59:59Z", ...extra });

describe("parsing", () => {
  it("reads thresholds with units and comparators", () => {
    expect(parseThreshold("Will BTC close above $100k on Dec 31?")).toMatchObject({ value: 100000, comparator: "above" });
    expect(parseThreshold("Will ETH drop below 2,500 by Friday")).toMatchObject({ value: 2500, comparator: "below" });
    expect(parseThreshold("CPI y/y above 3.1%")).toMatchObject({ value: 3.1, pct: true });
    expect(parseThreshold("US debt exceed $41 trillion")).toMatchObject({ value: 41e12 });
    expect(parseThreshold("Who wins the election?")).toBeNull();
  });

  it("reads deadlines in both date orders and falls back to close time", () => {
    expect(parseDeadline("by December 5, 2026", "2027-01-01T00:00:00Z")).toBe("2026-12-05T23:59:59.000Z");
    expect(parseDeadline("on 5 Dec", "2026-12-31T00:00:00Z")).toBe("2026-12-05T23:59:59.000Z");
    expect(parseDeadline("before 2027", "2027-06-01T00:00:00Z")).toBe("2026-12-31T23:59:59.000Z");
    expect(parseDeadline("no date here", "2026-12-31T00:00:00Z")).toBe("2026-12-31T00:00:00Z");
  });

  it("finds the reference month of a data release but not a deadline", () => {
    expect(referencePeriod("Will November CPI exceed 3%?", "2026-12-20T00:00:00Z")).toBe("2026-11-01");
    expect(referencePeriod("Will BTC be above $70k on December 5?", "2026-12-20T00:00:00Z")).toBeNull();
  });
});

describe("planMarket", () => {
  it("maps crypto price questions", () => {
    const r = planMarket(market("Will Bitcoin reach $100,000 by December 31, 2026?"));
    expect(r.plan).toMatchObject({ kind: "price", label: "BTC-USD", threshold: 100000, mode: "touch" });
  });
  it("maps macro questions to official series", () => {
    expect(planMarket(market("Will US CPI inflation for November be above 3.0%?")).plan).toMatchObject({ kind: "next-print", transform: "yoy", threshold: 3 });
    expect(planMarket(market("Will core CPI be above 3% y/y?")).plan).toMatchObject({ ref: { id: "CUUR0000SA0L1E" } });
  });
  it("abstains on questions primary data cannot settle", () => {
    expect(planMarket(market("Will Taylor Swift announce a new album?")).plan).toBeNull();
  });
  it("prefers human-curated overrides", () => {
    const plan = { kind: "trend-level" as const, ref: { source: "fred", id: "X" }, label: "x", threshold: 1, comparator: "above" as const, deadline: "2026-12-31" };
    expect(planMarket(market("anything"), { m1: plan })).toMatchObject({ plan, confidence: 1 });
  });
});

describe("odds", () => {
  it("normCdf is accurate", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
  it("price odds behave sensibly", () => {
    const far = priceThresholdOdds({ spot: 64000, threshold: 100000, dailyVol: 0.02, days: 30, mode: "close" });
    const near = priceThresholdOdds({ spot: 64000, threshold: 65000, dailyVol: 0.02, days: 30, mode: "close" });
    expect(far.probability).toBeLessThan(0.01);
    expect(near.probability).toBeGreaterThan(0.3);
    const touch = priceThresholdOdds({ spot: 64000, threshold: 65000, dailyVol: 0.02, days: 30, mode: "touch" });
    expect(touch.probability).toBeGreaterThan(near.probability);
  });
  it("next-print odds use base effects", () => {
    const series: Series = {
      ref: { source: "x", id: "y" },
      title: "t",
      unit: "index",
      frequency: "monthly",
      observations: Array.from({ length: 30 }, (_, i) => ({ date: `m${i}`, value: 100 * 1.002 ** i })),
      provenance: { publisher: "p", sourceUrl: "", dataUrl: "", retrievedAt: "", contentHash: "" },
    };
    const low = nextPrintOdds({ series, transform: "yoy", threshold: 1.0, direction: "above" });
    const high = nextPrintOdds({ series, transform: "yoy", threshold: 5.0, direction: "above" });
    expect(low.probability).toBeGreaterThan(0.9);
    expect(high.probability).toBeLessThan(0.1);
  });
});

describe("mine", () => {
  const http = fakeHttp({
    "https://api.exchange.coinbase.com/products/BTC-USD/candles": candles(),
    "https://api.bls.gov/": JSON.stringify({ status: "REQUEST_NOT_PROCESSED", message: ["daily threshold"] }),
    "https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCNS": cpiCsv(),
  });

  it("produces sourced, quoted, decisive evidence for a far-away price target", async () => {
    const events: string[] = [];
    const recorder: Recorder = { record: (k) => void events.push(k) };
    const m = market("Will Bitcoin close above $150,000 on December 31, 2026?");
    const r = await mine(m, planMarket(m).plan!, { http, now: () => NOW, recorder });
    expect(r.status).toBe("evidence");
    if (r.status !== "evidence") return;
    expect(r.item.stance).toBe("NO");
    expect(r.item.note).toMatch(/Coinbase Exchange/);
    expect(r.item.note).toMatch(/raw: "\[/);
    expect(r.item.note).toMatch(/sha256 [0-9a-f]{12}/);
    expect(r.item.links.some((l) => l.includes("api.exchange.coinbase.com"))).toBe(true);
    expect(events).toEqual(["source.fetch", "analysis", "evidence.created"]);
  });

  it("abstains when the odds are not decisive", async () => {
    const m = market("Will Bitcoin close above $64,500 on December 31, 2026?");
    const r = await mine(m, planMarket(m).plan!, { http, now: () => NOW });
    expect(r.status).toBe("abstain");
  });

  it("abstains when the market already agrees", async () => {
    const m = market("Will Bitcoin close above $150,000 on December 31, 2026?", { yesPrice: 0.03 });
    const r = await mine(m, planMarket(m).plan!, { http, now: () => NOW });
    expect(r).toMatchObject({ status: "abstain", reason: expect.stringMatching(/already prices/) });
  });

  it("falls back from BLS to FRED and reports an already-published figure", async () => {
    const events: { k: string; p: Record<string, unknown> }[] = [];
    const m = market("Will US CPI inflation for October 2026 be above 4%?", { closeTime: "2026-12-15T00:00:00Z" });
    const r = await mine(m, planMarket(m).plan!, { http, now: () => NOW, recorder: { record: (k, p) => void events.push({ k, p }) } });
    expect(events[0]).toMatchObject({ k: "error", p: { recovery: "fallback series" } });
    expect(r.status).toBe("evidence");
    if (r.status === "evidence") {
      expect(r.item.stance).toBe("NO");
      expect(r.item.method).toMatch(/already published/);
    }
  });
});

describe("novelty", () => {
  const item = { marketId: "m1", note: "BTC needs +56% to close above 100k in 41 days; volatility says 0.4%", fingerprint: "f1", stance: "NO" as const };
  it("blocks exact repeats, both-sides arguments and near-duplicates", () => {
    expect(checkNovelty(item, [{ marketId: "m1", text: "x", fingerprint: "f1" }])).toMatchObject({ novel: false });
    expect(checkNovelty(item, [{ marketId: "m1", text: "x", stance: "YES", own: true }])).toMatchObject({ novel: false, reason: expect.stringMatching(/stance lock/) });
    expect(checkNovelty(item, [{ marketId: "m1", text: item.note }])).toMatchObject({ novel: false });
    expect(checkNovelty(item, [{ marketId: "m2", text: item.note }])).toEqual({ novel: true });
  });
});

describe("business-day series (regression: weekend gap read as weekly)", () => {
  // +10 per business day, Mon–Fri only
  const obs: { date: string; value: number }[] = [];
  let v = 1000;
  for (let d = new Date("2026-09-01T00:00:00Z"); obs.length < 40; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    obs.push({ date: d.toISOString().slice(0, 10), value: (v += 10) });
  }
  const series: Series = {
    ref: { source: "x", id: "y" },
    title: "t",
    unit: "USD",
    frequency: guessFrequency(obs),
    observations: obs,
    provenance: { publisher: "p", sourceUrl: "", dataUrl: "", retrievedAt: "", contentHash: "" },
  };
  it("is detected as daily even when it ends after a weekend", () => {
    expect(series.frequency).toBe("daily");
  });
  it("extrapolates on calendar time", () => {
    const last = obs[obs.length - 1]!;
    const deadline = new Date(Date.parse(last.date) + 28 * 86_400_000).toISOString();
    const o = trendThresholdOdds({ series, threshold: last.value + 150, asOf: last.date, deadline, window: 24 });
    // 28 calendar days = 20 business days = +200 expected, so +150 should be likely
    expect(Number(o.inputs.projected)).toBeGreaterThan(last.value + 180);
    expect(o.probability).toBeGreaterThan(0.8);
  });
});

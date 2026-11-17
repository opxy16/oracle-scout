import type { FetchedDoc, Frequency, HttpGet, Observation, Series, SeriesRef, Source } from "./types.js";

/**
 * Keyless primary-data adapters. Each one returns a Series with verbatim `raw` fragments,
 * so every number in an evidence note can be quoted exactly as the publisher printed it.
 */

function prov(publisher: string, sourceUrl: string, doc: FetchedDoc, license?: string) {
  return { publisher, sourceUrl, dataUrl: doc.url, retrievedAt: doc.retrievedAt, contentHash: doc.contentHash, license };
}

function num(s: string | number | null | undefined): number | null {
  if (s === null || s === undefined || s === "" || s === ".") return null;
  const n = typeof s === "number" ? s : Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** FRED (St. Louis Fed) CSV download; no API key needed. Mirrors BLS, BEA, Fed H.15 etc. */
export const fred: Source = {
  id: "fred",
  publisher: "Federal Reserve Bank of St. Louis (FRED)",
  primary: false,
  async fetchSeries(ref, http) {
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(ref.id)}`;
    const doc = await http(url);
    const lines = doc.text.trim().split(/\r?\n/);
    const observations: Observation[] = [];
    for (const line of lines.slice(1)) {
      const [date, v] = line.split(",");
      const value = num(v);
      if (date && value !== null) observations.push({ date, value, raw: line });
    }
    return {
      ref,
      title: String(ref.params?.title ?? ref.id),
      unit: String(ref.params?.unit ?? ""),
      frequency: (ref.params?.frequency as Frequency) ?? guessFrequency(observations),
      observations,
      provenance: prov(this.publisher, `https://fred.stlouisfed.org/series/${ref.id}`, doc),
    };
  },
};

/** U.S. Bureau of Labor Statistics public API v1 (keyless, 25 queries/day). The primary source for CPI and jobs. */
export const bls: Source = {
  id: "bls",
  publisher: "U.S. Bureau of Labor Statistics",
  primary: true,
  async fetchSeries(ref, http) {
    const url = `https://api.bls.gov/publicAPI/v1/timeseries/data/${encodeURIComponent(ref.id)}`;
    const doc = await http(url);
    const json = JSON.parse(doc.text) as {
      status: string;
      message?: string[];
      Results?: { series: { data: { year: string; period: string; periodName: string; value: string }[] }[] };
    };
    if (json.status !== "REQUEST_SUCCEEDED") throw new Error(`BLS: ${json.status} ${json.message?.join(" ")}`);
    const rows = json.Results?.series[0]?.data ?? [];
    const observations = rows
      .filter((r) => /^M(0[1-9]|1[0-2])$/.test(r.period))
      .map((r) => ({
        date: `${r.year}-${r.period.slice(1)}-01`,
        value: num(r.value)!,
        raw: `${r.periodName} ${r.year}: ${r.value}`,
      }))
      .filter((o) => o.value !== null)
      .reverse();
    return {
      ref,
      title: String(ref.params?.title ?? ref.id),
      unit: String(ref.params?.unit ?? "index"),
      frequency: "monthly",
      observations,
      provenance: prov(this.publisher, `https://data.bls.gov/timeseries/${ref.id}`, doc, "Public domain (U.S. Government)"),
    };
  },
};

/** Coinbase Exchange public candles. ref.id = product, e.g. "BTC-USD". Daily closes (UTC). */
export const coinbase: Source = {
  id: "coinbase",
  publisher: "Coinbase Exchange",
  primary: true,
  async fetchSeries(ref, http) {
    const granularity = Number(ref.params?.granularity ?? 86400);
    const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(ref.id)}/candles?granularity=${granularity}`;
    const doc = await http(url);
    const rows = JSON.parse(doc.text) as [number, number, number, number, number, number][];
    // [time, low, high, open, close, volume], newest first
    const observations = rows
      .map((r) => ({ date: new Date(r[0] * 1000).toISOString().slice(0, granularity >= 86400 ? 10 : 19), value: r[4], raw: JSON.stringify(r) }))
      .reverse();
    return {
      ref,
      title: `${ref.id} ${granularity >= 86400 ? "daily close" : "close"}`,
      unit: ref.id.split("-")[1] ?? "USD",
      frequency: granularity >= 86400 ? "daily" : "intraday",
      observations,
      provenance: prov(this.publisher, `https://exchange.coinbase.com/trade/${ref.id}`, doc),
    };
  },
};

/** U.S. Treasury Fiscal Data API. ref.id = endpoint path; params.field = numeric column; params.dateField. */
export const treasury: Source = {
  id: "treasury",
  publisher: "U.S. Department of the Treasury (Fiscal Data)",
  primary: true,
  async fetchSeries(ref, http) {
    const field = String(ref.params?.field ?? "tot_pub_debt_out_amt");
    const dateField = String(ref.params?.dateField ?? "record_date");
    const filter = ref.params?.filter ? `&filter=${ref.params.filter}` : "";
    const url = `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/${ref.id}?sort=-${dateField}&page%5Bsize%5D=${ref.params?.size ?? 400}${filter}`;
    const doc = await http(url);
    const json = JSON.parse(doc.text) as { data: Record<string, string>[] };
    const observations = json.data
      .map((r) => ({ date: r[dateField]!, value: num(r[field])!, raw: `${r[dateField]}: ${field}=${r[field]}` }))
      .filter((o) => o.value !== null)
      .reverse();
    return {
      ref,
      title: String(ref.params?.title ?? `${ref.id} ${field}`),
      unit: String(ref.params?.unit ?? "USD"),
      frequency: guessFrequency(observations),
      observations,
      provenance: prov(this.publisher, "https://fiscaldata.treasury.gov/datasets/", doc, "Public domain (U.S. Government)"),
    };
  },
};

/** World Bank Indicators API. ref.id = indicator; params.country (ISO2/ISO3). Annual. */
export const worldBank: Source = {
  id: "worldbank",
  publisher: "World Bank (World Development Indicators)",
  primary: true,
  async fetchSeries(ref, http) {
    const country = String(ref.params?.country ?? "WLD");
    const url = `https://api.worldbank.org/v2/country/${country}/indicator/${encodeURIComponent(ref.id)}?format=json&per_page=80`;
    const doc = await http(url);
    const [, rows = []] = JSON.parse(doc.text) as [unknown, { date: string; value: number | null; indicator: { value: string } }[]];
    const observations = rows
      .filter((r) => r.value !== null)
      .map((r) => ({ date: `${r.date}-12-31`, value: r.value as number, raw: `${r.date}: ${r.value}` }))
      .reverse();
    return {
      ref,
      title: `${rows[0]?.indicator.value ?? ref.id} (${country})`,
      unit: String(ref.params?.unit ?? ""),
      frequency: "annual",
      observations,
      provenance: prov(this.publisher, `https://data.worldbank.org/indicator/${ref.id}?locations=${country}`, doc, "CC BY 4.0"),
    };
  },
};

/** Open-Meteo forecast/observations. ref.id = daily variable; params.lat, params.lon, params.label. */
export const openMeteo: Source = {
  id: "openmeteo",
  publisher: "Open-Meteo (national weather service models)",
  primary: false,
  async fetchSeries(ref, http) {
    const { lat, lon } = ref.params ?? {};
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=${ref.id}&past_days=${ref.params?.pastDays ?? 30}&forecast_days=${ref.params?.forecastDays ?? 14}&timezone=UTC`;
    const doc = await http(url);
    const json = JSON.parse(doc.text) as { daily: Record<string, (number | null)[]> & { time: string[] }; daily_units: Record<string, string> };
    const values = json.daily[ref.id] ?? [];
    const observations = json.daily.time
      .map((date, i) => ({ date, value: values[i] as number, raw: `${date}: ${values[i]}` }))
      .filter((o) => o.value !== null && o.value !== undefined);
    return {
      ref,
      title: `${ref.id} at ${ref.params?.label ?? `${lat},${lon}`}`,
      unit: json.daily_units[ref.id] ?? "",
      frequency: "daily",
      observations,
      provenance: prov(this.publisher, "https://open-meteo.com/", doc, "CC BY 4.0"),
    };
  },
};

export const SOURCES: Record<string, Source> = Object.fromEntries(
  [fred, bls, coinbase, treasury, worldBank, openMeteo].map((s) => [s.id, s]),
);

export function registerSource(source: Source): void {
  SOURCES[source.id] = source;
}

export async function fetchSeries(ref: SeriesRef, http: HttpGet): Promise<Series> {
  const source = SOURCES[ref.source];
  if (!source) throw new Error(`Unknown source "${ref.source}"`);
  const series = await source.fetchSeries(ref, http);
  if (series.observations.length === 0) throw new Error(`${ref.source}:${ref.id} returned no observations`);
  return series;
}

function guessFrequency(obs: Observation[]): Frequency {
  if (obs.length < 3) return "irregular";
  const a = Date.parse(obs[obs.length - 2]!.date);
  const b = Date.parse(obs[obs.length - 1]!.date);
  const days = Math.abs(b - a) / 86_400_000;
  if (days <= 1.5) return "daily";
  if (days <= 8) return "weekly";
  if (days <= 32) return "monthly";
  if (days <= 93) return "quarterly";
  return "annual";
}

/** Where a number came from, precisely enough for someone else to re-fetch and re-hash it. */
export interface Provenance {
  publisher: string;
  /** Human-readable page for the series (what a reader clicks). */
  sourceUrl: string;
  /** Exact machine URL that was fetched. */
  dataUrl: string;
  retrievedAt: string;
  /** sha256 of the raw response body. */
  contentHash: string;
  license?: string;
}

export interface Observation {
  /** ISO date (YYYY-MM-DD) or timestamp. */
  date: string;
  value: number;
  /** Verbatim line/fragment of the raw response this value was parsed from. */
  raw?: string;
}

export type Frequency = "intraday" | "daily" | "weekly" | "monthly" | "quarterly" | "annual" | "irregular";

export interface Series {
  ref: SeriesRef;
  title: string;
  unit: string;
  frequency: Frequency;
  /** Oldest first. */
  observations: Observation[];
  provenance: Provenance;
}

/** Pointer to a series in a source, e.g. { source: "fred", id: "CPIAUCSL" }. */
export interface SeriesRef {
  source: string;
  id: string;
  params?: Record<string, string | number>;
}

export interface FetchedDoc {
  url: string;
  status: number;
  text: string;
  retrievedAt: string;
  contentHash: string;
}

export type HttpGet = (url: string, init?: { headers?: Record<string, string>; method?: string; body?: string }) => Promise<FetchedDoc>;

export interface Source {
  id: string;
  publisher: string;
  /** Primary = the official publisher of the statistic (not an aggregator). */
  primary: boolean;
  fetchSeries(ref: SeriesRef, http: HttpGet): Promise<Series>;
}

/** Optional sink so callers (e.g. an audit log) can record every step without coupling. */
export interface Recorder {
  record(kind: string, payload: Record<string, unknown>): Promise<unknown> | unknown;
}

export const nullRecorder: Recorder = { record: () => undefined };

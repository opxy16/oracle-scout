import { createHash } from "node:crypto";
import type { FetchedDoc, HttpGet } from "./types.js";

export const USER_AGENT = "OracleScout/0.1 (+https://github.com/opxy16/oracle-scout)";

export interface HttpOptions {
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
  /** Minimum gap between requests to the same host, to stay polite with public APIs. */
  minHostGapMs?: number;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** fetch with timeout, retry on 429/5xx, per-host pacing, and a content hash of the body. */
export function createHttp(opts: HttpOptions = {}): HttpGet {
  const { timeoutMs = 20_000, retries = 2, fetchImpl = fetch, minHostGapMs = 250 } = opts;
  const lastHit = new Map<string, number>();

  return async (url, init = {}) => {
    const host = new URL(url).host;
    let attempt = 0;
    for (;;) {
      const wait = (lastHit.get(host) ?? 0) + minHostGapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastHit.set(host, Date.now());
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, {
          method: init.method ?? "GET",
          body: init.body,
          headers: { "user-agent": USER_AGENT, accept: "*/*", ...init.headers },
          signal: ctrl.signal,
        });
        const text = await res.text();
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          attempt++;
          await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
        const doc: FetchedDoc = { url, status: res.status, text, retrievedAt: new Date().toISOString(), contentHash: sha256(text) };
        return doc;
      } catch (err) {
        if (attempt < retries && (err as Error).name === "AbortError") {
          attempt++;
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

/** Test helper: serve canned bodies keyed by URL prefix. */
export function fakeHttp(routes: Record<string, string>): HttpGet {
  return async (url) => {
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) throw new Error(`fakeHttp: no route for ${url}`);
    const text = routes[key]!;
    return { url, status: 200, text, retrievedAt: "2026-11-20T12:00:00.000Z", contentHash: sha256(text) };
  };
}

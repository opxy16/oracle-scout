"use client";
import { ArrowUpRight } from "lucide-react";
import type { AnchorRecord } from "@oracle-scout/ledger";
import type { ViewEntry } from "@/lib/view";

const KIND_LABEL: Record<string, string> = {
  "run.start": "Run started",
  "run.end": "Run finished",
  "market.triage": "Markets triaged",
  "source.fetch": "Source fetched",
  analysis: "Odds computed",
  "evidence.created": "Evidence written",
  "evidence.submitted": "Evidence submitted",
  "evidence.receipt": "Judge receipt",
  "guardrail.block": "Guardrail block",
  oversight: "Human oversight",
  anchor: "Anchored on chain",
  "pack.sold": "Pack sold",
  error: "Error",
};

/**
 * The hero: the agent's latest real log entries as a chain of custody. Each link shows its
 * own hash; the wire between two links carries the previous hash the next one commits to.
 * Entries covered by the latest anchor sit inside the seal's bracket.
 */
export function CustodyChain({ entries, anchor }: { entries: ViewEntry[]; anchor?: AnchorRecord }) {
  if (entries.length === 0) {
    return <div className="sheet rounded-xl p-6 text-sm text-ink2">The log is empty. The first run will start the chain.</div>;
  }
  const sealedUpTo = anchor?.toSeq ?? -1;
  const step = 110; // ms between links
  return (
    <figure className="sheet relative overflow-hidden rounded-xl p-5 sm:p-6" aria-label="Latest audit-log entries, linked by hash">
      <figcaption className="mb-4 flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold">Latest entries, newest last</span>
        <a href="#custody" className="text-ink2 underline-offset-4 hover:text-ink hover:underline">
          Full audit trail
        </a>
      </figcaption>
      <ol className="relative">
        {entries.map((e, i) => {
          const sealed = e.seq <= sealedUpTo;
          const next = entries[i + 1];
          return (
            <li key={e.seq} className="relative">
              <div className="chain-link grid grid-cols-[1.5rem_1fr] gap-3" style={{ animationDelay: `${i * step}ms` }}>
                <span className="relative mt-1.5 flex justify-center" aria-hidden="true">
                  <span className={`h-3.5 w-3.5 rounded-full border-2 ${sealed ? "border-seal bg-seal" : "border-ink2 bg-sheet"}`} />
                </span>
                <div className="min-w-0 rounded-lg border border-rule bg-paper/60 px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-sm font-semibold">
                      <span className="text-ink2">#{e.seq} </span>
                      {KIND_LABEL[e.kind] ?? e.kind}
                    </span>
                    <span className="hash">{e.entryHash.slice(0, 10)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ink2">{e.summary}</p>
                </div>
              </div>
              {next && (
                <div className="grid grid-cols-[1.5rem_1fr] gap-3" aria-hidden="true">
                  <svg viewBox="0 0 24 28" className="h-7 w-6">
                    <line className="chain-wire" x1="12" y1="0" x2="12" y2="28" stroke="rgb(var(--ink-2))" strokeWidth="2" style={{ animationDelay: `${i * step + 200}ms` }} />
                  </svg>
                  <span className="hash min-w-0 self-center truncate opacity-80">next entry commits to {e.entryHash.slice(0, 10)}</span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {anchor && (
        <div className="chain-stamp mt-5 flex items-center gap-3" style={{ animationDelay: `${entries.length * step + 250}ms` }}>
          <div className="rounded-lg border-[3px] border-double border-seal px-3 py-2 text-seal">
            <p className="display-sm text-base">Sealed on Concordium</p>
            <p className="hash !text-seal">
              entries {anchor.fromSeq}–{anchor.toSeq}, root {anchor.root.slice(0, 12)}
            </p>
          </div>
          {anchor.explorerUrl && (
            <a href={anchor.explorerUrl} className="inline-flex items-center gap-1 text-sm font-medium text-ink underline-offset-4 hover:underline">
              See the transaction <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
      )}
    </figure>
  );
}

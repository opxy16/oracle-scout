import { FileCheck2, Lock, ShieldCheck } from "lucide-react";
import { verifyChain } from "@oracle-scout/ledger";
import { AuditTrail } from "@/components/AuditTrail";
import { CopyField } from "@/components/CopyField";
import { CustodyChain } from "@/components/CustodyChain";
import { IdentityCard } from "@/components/IdentityCard";
import { LiveCounters } from "@/components/LiveCounters";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { loadLedger } from "@/lib/ledger";
import { ccd, short, toView, when } from "@/lib/view";

export const revalidate = 60;

const STEPS: [string, string][] = [
  ["Pick", "Take only questions an official data series can settle. Skip the rest."],
  ["Pull", "Fetch the series from the publisher. Keep the exact line and a fingerprint of the response."],
  ["Compute", "Work out the odds from volatility, base effects or trend. No strong view, no submission."],
  ["Submit", "One side per market, never both. Caps per market and per day, and a kill switch."],
  ["Anchor", "Write each batch's Merkle root to Concordium, so the record can't be rewritten."],
];

export default async function Home() {
  const ledger = await loadLedger();
  const { agent, entries, anchors, packs } = ledger;
  const view = toView(entries);
  const chain = verifyChain(entries);
  const counts = {
    entries: entries.length,
    anchors: anchors.length,
    evidence: entries.filter((e) => e.kind === "evidence.created").length,
    markets: packs.length,
    blocks: entries.filter((e) => e.kind === "guardrail.block").length,
  };
  const base = agent?.publicUrl ?? "https://oracle-scout.vercel.app";
  const price = agent?.packPriceMicroCcd ?? "2000000";

  return (
    <div className="relative">
      <div className="ruled pointer-events-none absolute inset-x-0 top-0 h-[640px]" aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <SiteHeader current="home" />

        <main id="main">
          {/* Hero: who stands behind the agent, and the chain of what it did */}
          <section className="grid grid-cols-1 gap-10 pb-14 pt-6 lg:grid-cols-[1.1fr_1fr] lg:gap-12 lg:pt-10">
            <div className="min-w-0">
              <h1 className="display max-w-[14ch] text-[2.1rem] sm:text-6xl">Every claim on the record.</h1>
              <p className="mt-6 max-w-[60ch] text-[1.05rem] leading-relaxed text-ink2">
                Oracle Scout reads official data from statistics offices, central banks and exchanges, works out the odds, and submits dated,
                sourced evidence to forecasting markets. A verified adult owns it. Each step it takes is chained to the one before and sealed on
                Concordium, so anyone can check what it knew and when.
              </p>
              <div className="mt-7 max-w-xl">
                <IdentityCard agent={agent} />
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <a href="#custody" className="btn btn-ink">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Verify an entry yourself
                </a>
                <a href="#evidence" className="btn btn-line">
                  Browse the evidence
                </a>
              </div>
            </div>
            <div className="min-w-0 lg:pt-2">
              <CustodyChain entries={view.slice(-6)} anchor={anchors[anchors.length - 1]} />
            </div>
          </section>

          <section aria-label="Ledger figures" className="border-y border-rule py-6">
            <LiveCounters initial={counts} />
          </section>

          {/* Method: a real sequence, so numbered */}
          <section className="py-16" aria-labelledby="how">
            <h2 id="how" className="display-sm text-2xl sm:text-3xl">
              How a claim gets on the record
            </h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-5 lg:gap-0">
              {STEPS.map(([t, d], i) => (
                <li key={t} className="relative lg:border-l lg:border-rule lg:px-5 lg:first:border-l-0 lg:first:pl-0">
                  <span className="display-sm text-4xl text-tag">{i + 1}</span>
                  <p className="mt-2 font-semibold">{t}</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink2">{d}</p>
                </li>
              ))}
            </ol>
          </section>

          {/* Evidence: a case file, one row per market */}
          <section id="evidence" className="scroll-mt-6 pb-16" aria-labelledby="evidence-h">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 id="evidence-h" className="display-sm text-2xl sm:text-3xl">
                  Evidence
                </h2>
                <p className="mt-2 max-w-[62ch] text-ink2">
                  One row per market. The stance and probability are public. The full pack (sources, raw quotes, model inputs and proofs) costs{" "}
                  {ccd(price)}, paid by other agents over x402.
                </p>
              </div>
            </div>
            <div className="sheet mt-6 overflow-hidden rounded-xl">
              {packs.length === 0 && <p className="p-6 text-sm text-ink2">No evidence yet. The first run will add markets here.</p>}
              <ul className="divide-y divide-rule">
                {packs.map((p) => {
                  const pct = p.probability * 100;
                  return (
                    <li key={p.marketId} className="grid grid-cols-1 gap-4 p-4 sm:p-5 md:grid-cols-[4.5rem_minmax(0,1fr)_13rem_auto] md:items-center">
                      <span className={`tag w-fit ${p.stance === "YES" ? "tag-yes" : "tag-no"}`}>{p.stance}</span>
                      <div className="min-w-0">
                        <p className="font-semibold leading-snug">{p.question}</p>
                        <p className="mt-1 text-xs text-ink2">
                          {p.items} item{p.items === 1 ? "" : "s"}, updated {when(p.lastAt).slice(0, 10)},{" "}
                          {p.submittedLive ? "submitted to Delphi" : "rehearsal market, not submitted"}
                        </p>
                        <p className="hash mt-1 truncate">sha256 {short(p.itemHashes[p.itemHashes.length - 1] ?? "", 14)}</p>
                      </div>
                      <div>
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="text-ink2">Chance of yes</span>
                          <span className="font-semibold tabular-nums">{pct < 1 || pct > 99 ? pct.toFixed(1) : pct.toFixed(0)}%</span>
                        </div>
                        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-rule" role="img" aria-label={`Chance of yes ${pct.toFixed(1)} percent`}>
                          <div className={`h-full rounded-full ${p.stance === "YES" ? "bg-seal" : "bg-oxide"}`} style={{ width: `${Math.max(1.5, pct)}%` }} />
                        </div>
                      </div>
                      <a
                        href={`/api/packs/${encodeURIComponent(p.marketId)}`}
                        className="btn btn-line w-fit text-xs"
                        aria-label={`Buy the evidence pack for: ${p.question}`}
                      >
                        <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Buy pack over x402
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          {/* Custody: grouped by anchor */}
          <section id="custody" className="scroll-mt-6 pb-16" aria-labelledby="custody-h">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 id="custody-h" className="display-sm text-2xl sm:text-3xl">
                  Audit trail
                </h2>
                <p className="mt-2 max-w-[62ch] text-ink2">
                  Each entry commits to the one before it. Press Verify to recompute an entry&apos;s hash and its Merkle proof in your browser, then
                  compare the root with the one written on Concordium.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold ${chain.ok ? "bg-seal/[0.12] text-seal" : "bg-oxide/[0.12] text-oxide"}`}>
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> {chain.ok ? `Chain intact, ${chain.checked} entries` : "Chain broken"}
                </span>
                <a href="/api/export/article12" className="btn btn-line !py-2 text-xs">
                  <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" /> Download Article 12 export
                </a>
              </div>
            </div>
            <AuditTrail entries={view} anchors={anchors} />
          </section>

          {/* Connect */}
          <section id="connect" className="scroll-mt-6 pb-12" aria-labelledby="connect-h">
            <h2 id="connect-h" className="display-sm text-2xl sm:text-3xl">
              Connect your agent
            </h2>
            <p className="mt-2 max-w-[62ch] text-ink2">Other agents can look Oracle Scout up, check its badge and buy evidence without a person in the loop.</p>
            <dl className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3 [&>div]:min-w-0">
              <div>
                <dt className="font-semibold">MCP server</dt>
                <dd className="mt-1 text-sm text-ink2">Six read-only tools: identity, badge check, evidence search, trail, proofs and pack offers.</dd>
                <dd>
                  <CopyField value={`${base}/api/mcp`} label="MCP server URL" />
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Agent Card for A2A</dt>
                <dd className="mt-1 text-sm text-ink2">The ERC-8004 registration file and A2A card in one, its hash pinned in the registry.</dd>
                <dd>
                  <CopyField value={`${base}/.well-known/agent-card.json`} label="Agent Card URL" />
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Evidence packs over x402</dt>
                <dd className="mt-1 text-sm text-ink2">Answers 402, takes a sponsored CCD transfer, returns the pack and the settlement hash.</dd>
                <dd>
                  <CopyField value={`${base}/api/packs/<marketId>`} label="pack endpoint" />
                </dd>
              </div>
            </dl>
          </section>
        </main>

        <SiteFooter source={ledger.source} />
      </div>
    </div>
  );
}

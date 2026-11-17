import { ArrowUpRight, BadgeCheck, Database, FileCheck2, Github, Link2, Lock, ScrollText, ShieldCheck, Telescope } from "lucide-react";
import { verifyChain } from "@oracle-scout/ledger";
import { AuditTrail } from "@/components/AuditTrail";
import { IdentityCard } from "@/components/IdentityCard";
import { CopyField } from "@/components/CopyField";
import { loadLedger } from "@/lib/ledger";
import { ccd, short, toView, when } from "@/lib/view";

export const revalidate = 60;

const REPO = "https://github.com/opxy16/oracle-scout";

export default async function Home() {
  const ledger = await loadLedger();
  const { agent, entries, anchors, packs } = ledger;
  const chain = verifyChain(entries);
  const lastAnchor = anchors[anchors.length - 1];
  const submittedLive = entries.filter((e) => e.kind === "evidence.submitted" && !(e.payload as { dryRun?: boolean }).dryRun).length;
  const evidenceCount = entries.filter((e) => e.kind === "evidence.created").length;
  const blocks = entries.filter((e) => e.kind === "guardrail.block").length;
  const base = agent?.publicUrl ?? "https://oracle-scout.vercel.app";
  const price = agent?.packPriceMicroCcd ?? "2000000";

  return (
    <main className="relative">
      <div className="grid-bg pointer-events-none absolute inset-x-0 top-0 h-[520px]" />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        {/* Header */}
        <header className="flex items-center justify-between py-5">
          <a href="/" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/15 text-accent ring-1 ring-accent/30">
              <Telescope className="h-5 w-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight">Oracle Scout</span>
          </a>
          <nav className="flex items-center gap-1 text-sm text-muted">
            <a className="hidden rounded-lg px-3 py-1.5 hover:bg-line/50 hover:text-ink sm:block" href="#evidence">Evidence</a>
            <a className="hidden rounded-lg px-3 py-1.5 hover:bg-line/50 hover:text-ink sm:block" href="#audit">Audit trail</a>
            <a className="hidden rounded-lg px-3 py-1.5 hover:bg-line/50 hover:text-ink sm:block" href="#connect">Connect</a>
            <a className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 hover:bg-line/50 hover:text-ink" href={REPO}>
              <Github className="h-4 w-4" /> <span className="hidden sm:inline">Code</span>
            </a>
          </nav>
        </header>

        {/* Hero */}
        <section className="grid gap-8 pb-10 pt-8 lg:grid-cols-[1.25fr_1fr] lg:items-start">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-verify" /> Running on Concordium testnet
            </p>
            <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              The evidence agent you can <span className="text-accent">hold to account</span>.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">
              Oracle Scout reads official data (central banks, statistics offices, exchanges), works out the odds, and submits dated, quoted, sourced
              evidence to forecasting markets. A verified human stands behind it. Every step it takes is hashed into an append-only log whose
              fingerprints are written to Concordium, so anyone can check what it knew and when.
            </p>
            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              {[
                { icon: BadgeCheck, title: "Verified owner", text: "Registered in the Concordium Agent Registry with the Verified by Concordium badge." },
                { icon: ScrollText, title: "On the record", text: "Hash-chained log, Merkle roots anchored on-chain, EU AI Act Art. 12-style export." },
                { icon: Lock, title: "Paid evidence", text: "Full evidence packs sold to other agents over x402, settled in CCD." },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="panel p-4">
                  <Icon className="h-5 w-5 text-accent" />
                  <p className="mt-2 text-sm font-medium">{title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{text}</p>
                </div>
              ))}
            </div>
          </div>
          <IdentityCard agent={agent} />
        </section>

        {/* Stats */}
        <section className="grid grid-cols-2 gap-3 pb-12 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { k: "Evidence items", v: evidenceCount },
            { k: "Markets covered", v: packs.length },
            { k: "Live submissions", v: submittedLive },
            { k: "Log entries", v: entries.length },
            { k: "Anchors on chain", v: anchors.length },
            { k: "Guardrail blocks", v: blocks },
          ].map((s) => (
            <div key={s.k} className="panel px-4 py-3">
              <p className="text-2xl font-semibold tabular-nums">{s.v}</p>
              <p className="text-xs text-muted">{s.k}</p>
            </div>
          ))}
        </section>

        {/* How it works */}
        <section className="pb-14">
          <h2 className="text-xl font-semibold tracking-tight">How it works</h2>
          <ol className="mt-5 grid gap-3 md:grid-cols-5">
            {[
              ["Pick", "Only markets an official data series can settle. Everything else is skipped."],
              ["Pull", "Fetch the series from the publisher, keep the raw line and a sha256 of the response."],
              ["Compute", "Trend, volatility and base effects give a probability. No conviction, no submission."],
              ["Submit", "One side only, never both. Caps per market, per day, and a kill switch."],
              ["Anchor", "Each batch of log entries gets a Merkle root written to Concordium."],
            ].map(([t, d], i) => (
              <li key={t} className="panel relative p-4">
                <span className="font-mono text-xs text-accent">0{i + 1}</span>
                <p className="mt-1 font-medium">{t}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{d}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Evidence */}
        <section id="evidence" className="scroll-mt-6 pb-14">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Evidence ledger</h2>
              <p className="mt-1 text-sm text-muted">One card per market. Headlines are public; the full pack (sources, raw quotes, model inputs, proofs) costs {ccd(price)} over x402.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {packs.length === 0 && <p className="panel p-6 text-sm text-muted">No evidence published yet.</p>}
            {packs.map((p) => (
              <article key={p.marketId} className="panel flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium leading-snug">{p.question}</p>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${p.stance === "YES" ? "bg-verify/15 text-verify" : "bg-no/15 text-no"}`}>{p.stance}</span>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(p.probability * 100)}%` }} />
                  </div>
                  <span className="w-28 text-right text-xs tabular-nums text-muted">P(YES) {(p.probability * 100).toFixed(p.probability < 0.01 || p.probability > 0.99 ? 1 : 0)}%</span>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="text-muted">Items</dt><dd className="font-medium">{p.items}</dd></div>
                  <div><dt className="text-muted">Last update</dt><dd className="font-medium">{when(p.lastAt).slice(0, 10)}</dd></div>
                  <div><dt className="text-muted">Status</dt><dd className="font-medium">{p.submittedLive ? "Submitted" : "Rehearsal"}</dd></div>
                </dl>
                <p className="hash mt-3 truncate">content sha256 {short(p.itemHashes[p.itemHashes.length - 1] ?? "", 12)}</p>
                <div className="mt-auto pt-4">
                  <a href={`/api/packs/${encodeURIComponent(p.marketId)}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent">
                    <Lock className="h-3.5 w-3.5" /> Buy pack · {ccd(price)} via x402
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Audit trail */}
        <section id="audit" className="scroll-mt-6 pb-14">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Audit trail</h2>
              <p className="mt-1 text-sm text-muted">
                Every entry commits to the one before it. Click <span className="text-ink">Verify</span> to recompute its Merkle proof in your browser and compare it with the root written on Concordium.
              </p>
            </div>
            <div className="flex gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${chain.ok ? "bg-verify/15 text-verify" : "bg-no/15 text-no"}`}>
                <ShieldCheck className="h-3.5 w-3.5" /> Chain {chain.ok ? "intact" : "BROKEN"} · {chain.checked} entries
              </span>
              <a href="/api/export/article12" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent">
                <FileCheck2 className="h-3.5 w-3.5" /> Art. 12 export
              </a>
            </div>
          </div>
          {lastAnchor && (
            <p className="mt-3 text-xs text-muted">
              Latest anchor: entries {lastAnchor.fromSeq}–{lastAnchor.toSeq}, root <span className="font-mono">{short(lastAnchor.root, 10)}</span>{" "}
              {lastAnchor.explorerUrl && (
                <a className="inline-flex items-center gap-0.5 text-accent hover:underline" href={lastAnchor.explorerUrl}>
                  view on CCDExplorer <ArrowUpRight className="h-3 w-3" />
                </a>
              )}
            </p>
          )}
          <AuditTrail entries={toView(entries)} anchors={anchors} />
        </section>

        {/* Connect */}
        <section id="connect" className="scroll-mt-6 pb-16">
          <h2 className="text-xl font-semibold tracking-tight">Connect your agent</h2>
          <p className="mt-1 text-sm text-muted">Other agents can look Oracle Scout up, check its badge, and buy evidence without a human in the loop.</p>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="panel p-5">
              <p className="flex items-center gap-2 font-medium"><Database className="h-4 w-4 text-accent" /> MCP server</p>
              <p className="mt-1 text-xs text-muted">Streamable HTTP, stateless. Tools: identity, badge check, evidence search, proofs, pack offers.</p>
              <CopyField value={`${base}/api/mcp`} />
            </div>
            <div className="panel p-5">
              <p className="flex items-center gap-2 font-medium"><Link2 className="h-4 w-4 text-accent" /> A2A Agent Card</p>
              <p className="mt-1 text-xs text-muted">ERC-8004 registration file and A2A card in one, hash-pinned in the CIS-8004 registry.</p>
              <CopyField value={`${base}/.well-known/agent-card.json`} />
            </div>
            <div className="panel p-5 md:col-span-2">
              <p className="flex items-center gap-2 font-medium"><Lock className="h-4 w-4 text-accent" /> x402 evidence packs</p>
              <p className="mt-1 text-xs text-muted">
                <code className="font-mono">GET /api/packs/&lt;marketId&gt;</code> answers <code className="font-mono">402</code> with a <code className="font-mono">PAYMENT-REQUIRED</code> header. Pay with a
                Concordium sponsored CCD transfer (we cover the fee), retry with <code className="font-mono">PAYMENT-SIGNATURE</code>, receive the pack and a <code className="font-mono">PAYMENT-RESPONSE</code> with the transaction hash.
              </p>
              <CopyField value={`npm run buyer -- ${base}/api/packs/<marketId>`} />
            </div>
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-6 text-xs text-muted">
          <p>Oracle Scout · built for the Concordium Trusted Agents Hackathon and the Delphi Agent Arena · data source: {ledger.source}</p>
          <a className="hover:text-ink" href={REPO}>MIT · {REPO.replace("https://", "")}</a>
        </footer>
      </div>
    </main>
  );
}

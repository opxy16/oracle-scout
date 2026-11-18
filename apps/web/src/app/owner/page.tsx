import { ArrowLeft, EyeOff, Fingerprint, Link2, ShieldCheck, Telescope } from "lucide-react";
import { OwnerProofFlow } from "@/components/OwnerProofFlow";
import { PublishedProof } from "@/components/PublishedProof";

export const metadata = { title: "Owner proof — Oracle Scout" };

export default function OwnerPage() {
  return (
    <main className="relative">
      <div className="grid-bg pointer-events-none absolute inset-x-0 top-0 h-[420px]" />
      <div className="relative mx-auto max-w-4xl px-4 sm:px-6">
        <header className="flex items-center justify-between py-5">
          <a href="/" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/15 text-accent ring-1 ring-accent/30">
              <Telescope className="h-5 w-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight">Oracle Scout</span>
          </a>
          <a href="/" className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-line/50 hover:text-ink">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </a>
        </header>

        <section className="pb-8 pt-6">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted">
            <Fingerprint className="h-3.5 w-3.5 text-accent" /> Concordium ID · zero-knowledge proof
          </p>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            A verified adult owns this agent. <span className="text-accent">Nothing else is revealed.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted">
            The registry badge shows that Oracle Scout is owned by a Concordium account, and every Concordium account is backed by an identity
            checked by an identity provider. This page goes one step further: the owner proves, with a zero-knowledge proof from their wallet,
            that the identity behind that exact account belongs to someone aged 18 or over. The proof is bound to agent token #1253 and anyone
            can re-verify it against the chain.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              { icon: ShieldCheck, t: "Proven", d: "Date of birth lies in a range that means age ≥ 18, signed off by the identity provider." },
              { icon: EyeOff, t: "Hidden", d: "Name, date of birth, nationality, document numbers: none of it leaves the wallet." },
              { icon: Link2, t: "Bound", d: "The challenge names agent #1253 and its owner account; the proving credential must belong to that account." },
            ].map(({ icon: Icon, t, d }) => (
              <div key={t} className="panel p-4">
                <Icon className="h-5 w-5 text-accent" />
                <p className="mt-2 text-sm font-medium">{t}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="pb-10">
          <h2 className="text-xl font-semibold tracking-tight">Published proof</h2>
          <p className="mt-1 text-sm text-muted">Re-verified live against Concordium testnet every time this page loads.</p>
          <PublishedProof />
        </section>

        <section className="pb-16">
          <h2 className="text-xl font-semibold tracking-tight">For the owner: create a proof</h2>
          <p className="mt-1 text-sm text-muted">Needs Concordium Wallet for Web on testnet, with the agent&apos;s owner account.</p>
          <OwnerProofFlow />
        </section>
      </div>
    </main>
  );
}

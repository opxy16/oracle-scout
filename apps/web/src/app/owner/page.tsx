import { EyeOff, Link2, ShieldCheck } from "lucide-react";
import { OwnerProofFlow } from "@/components/OwnerProofFlow";
import { PublishedProof } from "@/components/PublishedProof";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";

export const metadata = { title: "Owner proof: Oracle Scout" };

const FACTS = [
  { icon: ShieldCheck, t: "What is proven", d: "The date of birth on the owner's identity lies in a range that means 18 or over, as signed off by the identity provider." },
  { icon: EyeOff, t: "What stays hidden", d: "Name, date of birth, nationality and document numbers. None of it leaves the wallet." },
  { icon: Link2, t: "How it is tied to the agent", d: "The challenge names agent #1253 and its owner account, and the proving credential must belong to that account." },
];

export default function OwnerPage() {
  return (
    <div className="relative">
      <div className="ruled pointer-events-none absolute inset-x-0 top-0 h-[480px]" aria-hidden="true" />
      <div className="relative mx-auto max-w-5xl px-4 sm:px-6">
        <SiteHeader current="owner" />
        <main id="main">
          <section className="grid grid-cols-1 gap-10 pb-12 pt-6 lg:grid-cols-[1.15fr_1fr] lg:pt-10">
            <div className="min-w-0">
              <h1 className="display max-w-[16ch] text-[2rem] sm:text-5xl">A verified adult owns this agent.</h1>
              <p className="mt-6 max-w-[60ch] text-[1.05rem] leading-relaxed text-ink2">
                The registry badge shows Oracle Scout is owned by a Concordium account, and every Concordium account is backed by an identity that
                an identity provider has checked. Here the owner goes one step further: a zero-knowledge proof from their wallet shows the identity
                behind that exact account belongs to someone aged 18 or over. Nothing else is revealed, and anyone can re-check the proof against the
                chain.
              </p>
            </div>
            <dl className="space-y-5 lg:pt-3">
              {FACTS.map(({ icon: Icon, t, d }) => (
                <div key={t} className="flex gap-3">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-tag" aria-hidden="true" />
                  <div>
                    <dt className="font-semibold">{t}</dt>
                    <dd className="mt-0.5 text-sm leading-relaxed text-ink2">{d}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </section>

          <section className="border-t border-rule py-12" aria-labelledby="published-h">
            <h2 id="published-h" className="display-sm text-2xl sm:text-3xl">
              The published proof
            </h2>
            <p className="mt-2 text-ink2">Checked again against Concordium testnet each time this page loads.</p>
            <PublishedProof />
          </section>

          <section className="border-t border-rule py-12" aria-labelledby="create-h">
            <h2 id="create-h" className="display-sm text-2xl sm:text-3xl">
              Create a new proof
            </h2>
            <p className="mt-2 max-w-[62ch] text-ink2">For the owner only. You need Concordium Wallet for Web on testnet, unlocked, with the agent&apos;s owner account.</p>
            <OwnerProofFlow />
          </section>
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}

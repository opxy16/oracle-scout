"use client";
import { ArrowUpRight, BadgeCheck, CircleDashed, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";

interface Agent {
  name: string;
  agentId: string;
  network: string;
  ownerAccount?: string;
  registry?: { tokenId?: string; badge?: string; contract: string };
}

type Status = "checking" | "ok" | "pending" | "failed";
const REGISTRY = "https://agent-registry-mcp.concordium.com";

function StatusMark({ s }: { s: Status }) {
  if (s === "ok") return <BadgeCheck className="h-5 w-5 shrink-0 text-seal" aria-hidden="true" />;
  if (s === "checking") return <CircleDashed className="h-5 w-5 shrink-0 animate-spin text-ink2" aria-hidden="true" />;
  return <ShieldAlert className={`h-5 w-5 shrink-0 ${s === "failed" ? "text-oxide" : "text-ink2"}`} aria-hidden="true" />;
}

/**
 * Who stands behind the agent, checked live in the visitor's browser:
 * the registry badge (Concordium's public API) and the published owner proof (our API, re-verified on chain).
 */
export function IdentityCard({ agent }: { agent: Agent | null }) {
  const badge = agent?.registry?.badge;
  const [badgeS, setBadgeS] = useState<Status>(badge ? "checking" : "pending");
  const [ownerS, setOwnerS] = useState<Status>("checking");

  useEffect(() => {
    if (badge) {
      fetch(`${REGISTRY}/v1/check-badge/${encodeURIComponent(badge)}?network=testnet`)
        .then((r) => r.json())
        .then((d: Record<string, unknown>) => setBadgeS(d.badge_valid === true ? "ok" : "failed"))
        .catch(() => setBadgeS("failed"));
    }
    fetch("/api/owner-proof", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setOwnerS(!j.present ? "pending" : j.live?.ok ? "ok" : "failed"))
      .catch(() => setOwnerS("failed"));
  }, [badge]);

  const owner = agent?.ownerAccount;
  const badgeText = { checking: "Checking the registry", ok: "Verified by Concordium", pending: "Registration pending", failed: "Badge check failed" }[badgeS];
  const ownerText = { checking: "Re-verifying the proof", ok: "Proven adult, nothing else revealed", pending: "Proof not published yet", failed: "Proof did not verify" }[ownerS];

  return (
    <dl className="divide-y divide-rule rounded-xl border border-rule bg-sheet text-sm">
      <div className="flex items-start gap-3 p-4">
        <StatusMark s={badgeS} />
        <div className="min-w-0 flex-1">
          <dt className="font-semibold">Registered agent {agent?.registry?.tokenId ? `#${agent.registry.tokenId}` : ""}</dt>
          <dd className="text-ink2">
            {badgeText}
            {badge && (
              <a className="ml-2 inline-flex items-center gap-0.5 text-ink underline-offset-4 hover:underline" href={`${REGISTRY}/v1/check-badge/${encodeURIComponent(badge)}?network=testnet`}>
                check it <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              </a>
            )}
          </dd>
        </div>
      </div>
      <div className="flex items-start gap-3 p-4">
        <StatusMark s={ownerS} />
        <div className="min-w-0 flex-1">
          <dt className="font-semibold">Human owner</dt>
          <dd className="text-ink2">
            {ownerText}
            <a className="ml-2 inline-flex items-center gap-0.5 text-ink underline-offset-4 hover:underline" href="/owner">
              see the proof <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </a>
          </dd>
        </div>
      </div>
      <div className="flex items-start gap-3 p-4">
        <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-dashed border-ink2" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <dt className="font-semibold">Owner account</dt>
          <dd className="break-all">
            {owner ? (
              <a className="hash underline-offset-4 hover:text-ink hover:underline" href={`https://ccdexplorer.io/testnet/account/${owner}`}>
                {owner}
              </a>
            ) : (
              <span className="text-ink2">Not set</span>
            )}
          </dd>
        </div>
      </div>
    </dl>
  );
}

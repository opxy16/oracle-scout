"use client";
import { ArrowUpRight, BadgeCheck, CircleDashed, ShieldAlert, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

interface Agent {
  name: string;
  agentId: string;
  network: string;
  ownerAccount?: string;
  registry?: { tokenId?: string; badge?: string; contract: string };
}

type Check = { state: "loading" } | { state: "none" } | { state: "ok"; data: Record<string, unknown> } | { state: "bad"; data?: Record<string, unknown>; error?: string };

const REGISTRY = "https://agent-registry-mcp.concordium.com";

export function IdentityCard({ agent }: { agent: Agent | null }) {
  const badge = agent?.registry?.badge;
  const [check, setCheck] = useState<Check>(badge ? { state: "loading" } : { state: "none" });

  useEffect(() => {
    if (!badge) return;
    fetch(`${REGISTRY}/v1/check-badge/${encodeURIComponent(badge)}?network=testnet`)
      .then(async (r) => {
        const data = (await r.json()) as Record<string, unknown>;
        const ok = data.badge_valid === true || data.valid === true;
        setCheck(ok ? { state: "ok", data } : { state: "bad", data });
      })
      .catch((e: Error) => setCheck({ state: "bad", error: e.message }));
  }, [badge]);

  const owner = agent?.ownerAccount;
  return (
    <aside className="panel overflow-hidden">
      <div className="border-b border-line bg-gradient-to-br from-accent/10 to-transparent p-5">
        <p className="text-xs uppercase tracking-wider text-muted">Agent identity</p>
        <div className="mt-3 flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-panel ring-1 ring-line">
            {check.state === "ok" ? <BadgeCheck className="h-7 w-7 text-verify" /> : check.state === "loading" ? <CircleDashed className="h-7 w-7 animate-spin text-muted" /> : <ShieldAlert className="h-7 w-7 text-accent" />}
          </span>
          <div>
            <p className="text-lg font-semibold">{agent?.name ?? "Oracle Scout"}</p>
            <p className="text-sm text-muted">
              {check.state === "ok" && <span className="text-verify">Verified by Concordium</span>}
              {check.state === "loading" && "Checking the registry…"}
              {check.state === "none" && "Registry entry pending"}
              {check.state === "bad" && <span className="text-no">Badge check failed</span>}
            </p>
          </div>
        </div>
      </div>
      <dl className="divide-y divide-line text-sm">
        <Row k="Registry" v={agent?.registry?.contract ? `CIS-8004 ${agent.registry.contract}` : "—"} />
        <Row k="Agent token" v={agent?.registry?.tokenId ? `#${agent.registry.tokenId}` : "—"} />
        <Row k="Badge" v={badge ?? "—"} mono />
        <Row
          k="Owner account"
          v={
            owner ? (
              <a className="inline-flex items-center gap-1 font-mono text-xs text-accent hover:underline" href={`https://ccdexplorer.io/testnet/account/${owner}`}>
                {owner.slice(0, 8)}…{owner.slice(-6)} <ArrowUpRight className="h-3 w-3" />
              </a>
            ) : (
              "—"
            )
          }
        />
        <Row k="Network" v={agent?.network ?? "concordium:testnet"} />
      </dl>
      <div className="flex items-start gap-2 border-t border-line p-4 text-xs leading-relaxed text-muted">
        <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <p>
          The owner account is backed by a Concordium identity issued by an identity provider. Nothing personal is published: accountability runs through the
          registry to the identity provider, which can only disclose the owner under legal process.
        </p>
      </div>
      {badge && (
        <a
          className="flex items-center justify-center gap-1 border-t border-line p-3 text-xs font-medium text-accent hover:bg-line/40"
          href={`${REGISTRY}/v1/check-badge/${encodeURIComponent(badge)}?network=testnet`}
        >
          Check the badge yourself <ArrowUpRight className="h-3 w-3" />
        </a>
      )}
    </aside>
  );
}

function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-2.5">
      <dt className="text-muted">{k}</dt>
      <dd className={`truncate text-right ${mono ? "font-mono text-xs" : ""}`}>{v}</dd>
    </div>
  );
}

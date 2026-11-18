"use client";
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

interface Live {
  ok: boolean;
  reasons: string[];
  challenge: string;
  credId?: string;
  account?: string;
  statement?: { type: string; attributeTag: string; lower: string; upper: string }[];
  verifiedAt: string;
}
type State =
  | { s: "loading" }
  | { s: "none" }
  | { s: "error"; msg: string }
  | { s: "done"; live: Live; record: { ctx: { tokenId: number; owner: string; issuedAt: string; minAge: number }; result: { verifiedAt: string } } };

export function PublishedProof() {
  const [st, setSt] = useState<State>({ s: "loading" });
  useEffect(() => {
    fetch("/api/owner-proof", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => (j.present ? setSt({ s: "done", live: j.live, record: j.record }) : j.error ? setSt({ s: "error", msg: j.error }) : setSt({ s: "none" })))
      .catch((e: Error) => setSt({ s: "error", msg: e.message }));
  }, []);

  if (st.s === "loading")
    return (
      <div className="panel mt-4 flex items-center gap-2 p-5 text-sm text-muted">
        <CircleDashed className="h-4 w-4 animate-spin" /> Re-verifying the published proof on Concordium testnet…
      </div>
    );
  if (st.s === "none") return <p className="panel mt-4 p-5 text-sm text-muted">No owner proof has been published yet.</p>;
  if (st.s === "error") return <p className="panel mt-4 p-5 text-sm text-no">Could not check the proof: {st.msg}</p>;

  const { live, record } = st;
  const range = live.statement?.find((x) => x.attributeTag === "dob");
  const rows: [string, React.ReactNode][] = [
    ["Statement", range ? `date of birth between ${fmt(range.lower)} and ${fmt(range.upper)} → age ≥ ${record.ctx.minAge}` : "—"],
    ["Bound to", `agent token #${record.ctx.tokenId}`],
    [
      "Owner account",
      live.account ? (
        <a className="font-mono text-xs text-accent hover:underline" href={`https://ccdexplorer.io/testnet/account/${live.account}`}>
          {live.account.slice(0, 10)}…{live.account.slice(-6)}
        </a>
      ) : (
        "—"
      ),
    ],
    ["Credential", <span key="c" className="font-mono text-xs">{live.credId ? `${live.credId.slice(0, 12)}…` : "—"}</span>],
    ["Proof created", new Date(record.ctx.issuedAt).toUTCString()],
    ["Re-verified", new Date(live.verifiedAt).toUTCString()],
  ];
  return (
    <div className={`panel mt-4 overflow-hidden ${live.ok ? "" : "border-no/50"}`}>
      <div className={`flex items-center gap-2 border-b border-line px-5 py-3 text-sm font-medium ${live.ok ? "bg-verify/10 text-verify" : "bg-no/10 text-no"}`}>
        {live.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        {live.ok ? "Valid: the agent's owner is a Concordium-verified adult" : `Not valid: ${live.reasons.join("; ")}`}
      </div>
      <dl className="divide-y divide-line text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 px-5 py-2.5">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-line px-5 py-3 text-xs text-muted">
        Raw record: <a className="text-accent hover:underline" href="https://github.com/opxy16/oracle-scout/blob/main/ledger/owner-proof.json">ledger/owner-proof.json</a> · API:{" "}
        <a className="text-accent hover:underline" href="/api/owner-proof">/api/owner-proof</a>
      </p>
    </div>
  );
}

const fmt = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

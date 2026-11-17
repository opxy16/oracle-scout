"use client";
import { ArrowUpRight, CheckCircle2, Clock, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { entryHashOf, inclusionProof, verifyInclusion, type AnchorRecord } from "@oracle-scout/ledger";
import type { ViewEntry } from "@/lib/view";

const KIND_STYLE: Record<string, string> = {
  "evidence.created": "bg-accent/15 text-accent",
  "evidence.submitted": "bg-verify/15 text-verify",
  "evidence.receipt": "bg-verify/15 text-verify",
  "guardrail.block": "bg-no/15 text-no",
  error: "bg-no/15 text-no",
  anchor: "bg-ink/10 text-ink",
  oversight: "bg-accent/15 text-accent",
};

type Result = { ok: boolean; lines: string[]; anchor?: AnchorRecord };

export function AuditTrail({ entries, anchors }: { entries: ViewEntry[]; anchors: AnchorRecord[] }) {
  const [shown, setShown] = useState(40);
  const [results, setResults] = useState<Record<number, Result>>({});
  const newestFirst = useMemo(() => [...entries].reverse(), [entries]);

  function verify(e: ViewEntry) {
    const lines: string[] = [];
    const recomputed = entryHashOf(e);
    const hashOk = recomputed === e.entryHash;
    lines.push(`entry hash recomputed from its fields: ${hashOk ? "matches" : "MISMATCH"}`);
    const prev = entries[e.seq - 1];
    const linkOk = e.seq === 0 ? e.prevHash === "0".repeat(64) : prev?.entryHash === e.prevHash;
    lines.push(`links to entry ${e.seq - 1}: ${linkOk ? "yes" : "NO"}`);
    const anchor = anchors.find((a) => e.seq >= a.fromSeq && e.seq <= a.toSeq);
    if (!anchor) {
      setResults((r) => ({ ...r, [e.seq]: { ok: hashOk && linkOk, lines: [...lines, "not anchored yet (next batch)"] } }));
      return;
    }
    const batch = entries.slice(anchor.fromSeq, anchor.toSeq + 1).map((x) => x.entryHash);
    const proof = inclusionProof(batch, e.seq - anchor.fromSeq);
    const inOk = verifyInclusion(proof, anchor.root);
    lines.push(`Merkle path of ${proof.path.length} steps reaches the anchored root: ${inOk ? "yes" : "NO"}`);
    setResults((r) => ({ ...r, [e.seq]: { ok: hashOk && linkOk && inOk, lines, anchor } }));
  }

  if (entries.length === 0) return <p className="panel mt-5 p-6 text-sm text-muted">The log is empty.</p>;

  return (
    <div className="panel mt-5 overflow-hidden">
      <ul className="divide-y divide-line">
        {newestFirst.slice(0, shown).map((e) => {
          const r = results[e.seq];
          return (
            <li key={e.seq} className="px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="w-12 font-mono text-xs text-muted">#{e.seq}</span>
                <span className={`rounded-md px-2 py-0.5 font-mono text-[11px] ${KIND_STYLE[e.kind] ?? "bg-line/60 text-muted"}`}>{e.kind}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{e.summary}</span>
                <span className="hidden font-mono text-[11px] text-muted md:inline">{e.entryHash.slice(0, 10)}…</span>
                <span className="hidden items-center gap-1 text-[11px] text-muted sm:inline-flex">
                  <Clock className="h-3 w-3" />
                  {e.ts.slice(5, 16).replace("T", " ")}
                </span>
                <button type="button" onClick={() => verify(e)} className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium hover:border-accent hover:text-accent">
                  Verify
                </button>
              </div>
              {r && (
                <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${r.ok ? "border-verify/40 bg-verify/5" : "border-no/40 bg-no/5"}`}>
                  <p className="flex items-center gap-1.5 font-medium">
                    {r.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-verify" /> : <XCircle className="h-3.5 w-3.5 text-no" />}
                    {r.ok ? "Verified in your browser" : "Verification failed"}
                  </p>
                  <ul className="mt-1 list-inside list-disc text-muted">
                    {r.lines.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                  {r.anchor && (
                    <p className="mt-1 text-muted">
                      Root <span className="font-mono">{r.anchor.root.slice(0, 16)}…</span> was written in transaction{" "}
                      {r.anchor.explorerUrl ? (
                        <a className="inline-flex items-center gap-0.5 font-mono text-accent hover:underline" href={r.anchor.explorerUrl}>
                          {r.anchor.txHash.slice(0, 12)}… <ArrowUpRight className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="font-mono">{r.anchor.txHash.slice(0, 12)}…</span>
                      )}
                      . Open it and compare the root in the registered data.
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {shown < entries.length && (
        <button type="button" onClick={() => setShown((s) => s + 60)} className="w-full border-t border-line py-3 text-xs font-medium text-muted hover:bg-line/40 hover:text-ink">
          Show older entries ({entries.length - shown} more)
        </button>
      )}
    </div>
  );
}

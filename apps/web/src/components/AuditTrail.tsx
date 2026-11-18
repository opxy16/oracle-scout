"use client";
import { ArrowUpRight, CheckCircle2, ChevronDown, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { entryHashOf, inclusionProof, verifyInclusion, type AnchorRecord } from "@oracle-scout/ledger";
import type { ViewEntry } from "@/lib/view";

const KIND_TONE: Record<string, string> = {
  "evidence.created": "text-tag",
  "evidence.submitted": "text-seal",
  "evidence.receipt": "text-seal",
  "guardrail.block": "text-oxide",
  error: "text-oxide",
  anchor: "text-seal",
  oversight: "text-tag",
};

type Result = { ok: boolean; lines: string[]; anchor?: AnchorRecord };

interface Group {
  key: string;
  title: string;
  anchor?: AnchorRecord;
  entries: ViewEntry[];
}

/** Entries grouped by the anchor that sealed them, newest batch first. Verify runs entirely in the browser. */
export function AuditTrail({ entries, anchors }: { entries: ViewEntry[]; anchors: AnchorRecord[] }) {
  const [open, setOpen] = useState(2);
  const [results, setResults] = useState<Record<number, Result>>({});

  const groups = useMemo<Group[]>(() => {
    const out: Group[] = [];
    const lastSealed = anchors.length ? anchors[anchors.length - 1]!.toSeq : -1;
    const pending = entries.filter((e) => e.seq > lastSealed);
    if (pending.length) out.push({ key: "pending", title: "Waiting for the next anchor", entries: [...pending].reverse() });
    [...anchors].reverse().forEach((a) => {
      out.push({
        key: `b${a.batch}`,
        title: `Batch ${a.batch + 1}: entries ${a.fromSeq}–${a.toSeq}, sealed on Concordium`,
        anchor: a,
        entries: entries.filter((e) => e.seq >= a.fromSeq && e.seq <= a.toSeq).reverse(),
      });
    });
    return out;
  }, [entries, anchors]);

  function verify(e: ViewEntry) {
    const lines: string[] = [];
    const hashOk = entryHashOf(e) === e.entryHash;
    lines.push(`Entry hash recomputed from its fields: ${hashOk ? "matches" : "does not match"}`);
    const prev = entries[e.seq - 1];
    const linkOk = e.seq === 0 ? e.prevHash === "0".repeat(64) : prev?.entryHash === e.prevHash;
    lines.push(e.seq === 0 ? `First entry starts from the zero hash: ${linkOk ? "yes" : "no"}` : `Commits to entry #${e.seq - 1}: ${linkOk ? "yes" : "no"}`);
    const anchor = anchors.find((a) => e.seq >= a.fromSeq && e.seq <= a.toSeq);
    if (!anchor) {
      setResults((r) => ({ ...r, [e.seq]: { ok: hashOk && linkOk, lines: [...lines, "Not anchored yet: it goes into the next batch"] } }));
      return;
    }
    const batch = entries.slice(anchor.fromSeq, anchor.toSeq + 1).map((x) => x.entryHash);
    const proof = inclusionProof(batch, e.seq - anchor.fromSeq);
    const inOk = verifyInclusion(proof, anchor.root);
    lines.push(`Merkle path of ${proof.path.length} step${proof.path.length === 1 ? "" : "s"} reaches the anchored root: ${inOk ? "yes" : "no"}`);
    setResults((r) => ({ ...r, [e.seq]: { ok: hashOk && linkOk && inOk, lines, anchor } }));
  }

  if (entries.length === 0) return <p className="sheet mt-6 rounded-xl p-6 text-sm text-ink2">The log is empty. The first run will start it.</p>;

  return (
    <div className="mt-6 space-y-4">
      {groups.slice(0, open).map((g) => (
        <section key={g.key} className="sheet overflow-hidden rounded-xl" aria-label={g.title}>
          <header className={`flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-3 sm:px-5 ${g.anchor ? "bg-seal/[0.07]" : "bg-tag/[0.08]"}`}>
            <h3 className="text-sm font-semibold">{g.title}</h3>
            {g.anchor?.explorerUrl && (
              <a href={g.anchor.explorerUrl} className="-my-1 inline-flex items-center gap-1 rounded py-1.5 text-xs font-medium underline-offset-4 hover:underline">
                <span className="hash !text-ink">root {g.anchor.root.slice(0, 10)}</span> transaction <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              </a>
            )}
          </header>
          <ul className="divide-y divide-rule">
            {g.entries.map((e) => {
              const r = results[e.seq];
              return (
                <li key={e.seq} className="px-4 py-3 sm:px-5">
                  <div className="grid grid-cols-[3rem_1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[3rem_9.5rem_1fr_auto_auto]">
                    <span className="hash">#{e.seq}</span>
                    <span className={`hidden text-xs font-semibold sm:block ${KIND_TONE[e.kind] ?? "text-ink2"}`}>{e.kind}</span>
                    <span className="min-w-0 truncate text-sm">{e.summary}</span>
                    <span className="hash hidden md:block">{e.entryHash.slice(0, 10)}</span>
                    <button
                      type="button"
                      onClick={() => verify(e)}
                      aria-expanded={Boolean(r)}
                      className="rounded-md border border-rule px-2.5 py-1 text-xs font-semibold transition-colors hover:border-ink active:scale-95"
                    >
                      Verify
                    </button>
                  </div>
                  {r && (
                    <div role="status" className={`mt-2.5 rounded-lg border px-3 py-2 text-xs ${r.ok ? "border-seal/50 bg-seal/[0.06]" : "border-oxide/50 bg-oxide/[0.06]"}`}>
                      <p className="flex items-center gap-1.5 font-semibold">
                        {r.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-seal" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5 text-oxide" aria-hidden="true" />}
                        {r.ok ? "Checked in your browser" : "Check failed"}
                      </p>
                      <ul className="mt-1 space-y-0.5 text-ink2">
                        {r.lines.map((l) => (
                          <li key={l}>{l}</li>
                        ))}
                      </ul>
                      {r.anchor && <p className="mt-1 text-ink2">Open the batch transaction and compare its memo with root {r.anchor.root.slice(0, 16)}.</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {open < groups.length && (
        <button type="button" onClick={() => setOpen(groups.length)} className="btn btn-line w-full justify-center">
          <ChevronDown className="h-4 w-4" aria-hidden="true" /> Show {groups.length - open} older batch{groups.length - open === 1 ? "" : "es"}
        </button>
      )}
    </div>
  );
}

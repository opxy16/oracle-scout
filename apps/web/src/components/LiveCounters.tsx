"use client";
import { useEffect, useRef, useState } from "react";

export interface Counts {
  entries: number;
  anchors: number;
  evidence: number;
  markets: number;
  blocks: number;
}

function useCountUp(target: number, ms = 900) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setV(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const eased = 1 - (1 - k) ** 3;
      setV(Math.round(a + (target - a) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function Count({ value, label }: { value: number; label: string }) {
  const v = useCountUp(value);
  return (
    <div>
      <dt className="text-xs text-ink2">{label}</dt>
      <dd className="display-sm text-2xl tabular-nums">{v}</dd>
    </div>
  );
}

/** Ledger figures that count up on load and refresh from /api/ledger every minute. */
export function LiveCounters({ initial }: { initial: Counts }) {
  const [c, setC] = useState(initial);
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const j = await fetch("/api/ledger", { cache: "no-store" }).then((r) => r.json());
        const packs = j.packs as { items: number }[];
        setC((prev) => ({
          ...prev,
          entries: j.chain?.entries ?? prev.entries,
          anchors: j.anchors?.length ?? prev.anchors,
          markets: packs?.length ?? prev.markets,
          evidence: packs ? packs.reduce((n, p) => n + p.items, 0) : prev.evidence,
        }));
      } catch {
        /* keep last known figures */
      }
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  return (
    <dl className="grid grid-cols-3 gap-x-6 gap-y-4 sm:grid-cols-5" aria-live="polite">
      <Count value={c.entries} label="Log entries" />
      <Count value={c.anchors} label="Anchors on chain" />
      <Count value={c.evidence} label="Evidence items" />
      <Count value={c.markets} label="Markets covered" />
      <Count value={c.blocks} label="Guardrail blocks" />
    </dl>
  );
}

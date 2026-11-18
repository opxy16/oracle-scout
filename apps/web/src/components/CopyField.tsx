"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyField({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label ?? value}`}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className="group mt-3 flex w-full items-center justify-between gap-2 rounded-md border border-rule bg-paper px-3 py-2 text-left transition-colors hover:border-ink active:scale-[0.995]"
    >
      <span className="hash truncate !text-ink">{value}</span>
      <span className="flex shrink-0 items-center gap-1 text-xs text-ink2" aria-live="polite">
        {done ? <Check className="h-3.5 w-3.5 text-seal" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
        {done ? "Copied" : "Copy"}
      </span>
    </button>
  );
}

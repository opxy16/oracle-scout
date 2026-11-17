"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyField({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className="mt-3 flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-bg px-3 py-2 text-left font-mono text-xs hover:border-accent"
    >
      <span className="truncate">{value}</span>
      {done ? <Check className="h-3.5 w-3.5 shrink-0 text-verify" /> : <Copy className="h-3.5 w-3.5 shrink-0 text-muted" />}
    </button>
  );
}

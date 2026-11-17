import type { EvidenceItem, Stance } from "./evidence.js";

/** Word 3-gram shingles for near-duplicate detection. */
export function shingles(text: string, n = 3): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9.%$ ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface PriorSubmission {
  marketId: string;
  text: string;
  fingerprint?: string;
  stance?: Stance;
  /** True for our own past submissions. */
  own?: boolean;
}

export type NoveltyVerdict = { novel: true } | { novel: false; reason: string };

/**
 * Evidence that repeats an earlier submission earns nothing, and evidence for both sides
 * of one market cancels out. So before submitting we check:
 *  1. same fingerprint (same market, same data point, same stance) -> duplicate
 *  2. our own earlier stance on this market differs -> refuse (never argue both sides)
 *  3. any visible submission on this market is >= `threshold` similar -> duplicate
 */
export function checkNovelty(item: Pick<EvidenceItem, "marketId" | "note" | "fingerprint" | "stance">, prior: PriorSubmission[], threshold = 0.5): NoveltyVerdict {
  const same = prior.filter((p) => p.marketId === item.marketId);
  if (same.some((p) => p.fingerprint && p.fingerprint === item.fingerprint)) return { novel: false, reason: "same data point already submitted" };
  const ownSide = same.find((p) => p.own && p.stance && p.stance !== item.stance);
  if (ownSide) return { novel: false, reason: `stance lock: already argued ${ownSide.stance} on this market` };
  const mine = shingles(item.note);
  for (const p of same) {
    const sim = jaccard(mine, shingles(p.text));
    if (sim >= threshold) return { novel: false, reason: `${(sim * 100).toFixed(0)}% overlap with an earlier ${p.own ? "own " : ""}submission` };
  }
  return { novel: true };
}

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

/**
 * RFC 6962-style Merkle tree (the Certificate Transparency construction):
 *   leaf  = H(0x00 || leafHash)
 *   node  = H(0x01 || left || right)
 * Domain separation stops a leaf being passed off as an inner node.
 * The tree splits at the largest power of two below n, so no duplication trick is
 * needed for odd counts and every leaf has exactly one valid proof.
 */

const LEAF = new Uint8Array([0]);
const NODE = new Uint8Array([1]);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function leafHash(entryHashHex: string): Uint8Array {
  return sha256(concat(LEAF, hexToBytes(entryHashHex)));
}

function nodeHash(l: Uint8Array, r: Uint8Array): Uint8Array {
  return sha256(concat(NODE, l, r));
}

function splitPoint(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

function rootOf(leaves: Uint8Array[]): Uint8Array {
  if (leaves.length === 0) return sha256(new Uint8Array());
  if (leaves.length === 1) return leaves[0]!;
  const k = splitPoint(leaves.length);
  return nodeHash(rootOf(leaves.slice(0, k)), rootOf(leaves.slice(k)));
}

/** Merkle root (hex) over a list of entry hashes (hex), in order. */
export function merkleRoot(entryHashes: string[]): string {
  return bytesToHex(rootOf(entryHashes.map(leafHash)));
}

export interface ProofStep {
  side: "L" | "R";
  hash: string;
}

export interface InclusionProof {
  index: number;
  size: number;
  leaf: string;
  path: ProofStep[];
  root: string;
}

/** Audit path for entry `index`, bottom-up. */
export function inclusionProof(entryHashes: string[], index: number): InclusionProof {
  if (index < 0 || index >= entryHashes.length) throw new RangeError("index out of range");
  const leaves = entryHashes.map(leafHash);
  const path: ProofStep[] = [];
  const walk = (ls: Uint8Array[], i: number): void => {
    if (ls.length <= 1) return;
    const k = splitPoint(ls.length);
    if (i < k) {
      walk(ls.slice(0, k), i);
      path.push({ side: "R", hash: bytesToHex(rootOf(ls.slice(k))) });
    } else {
      walk(ls.slice(k), i - k);
      path.push({ side: "L", hash: bytesToHex(rootOf(ls.slice(0, k))) });
    }
  };
  walk(leaves, index);
  return { index, size: entryHashes.length, leaf: entryHashes[index]!, path, root: bytesToHex(rootOf(leaves)) };
}

/** Recompute the root from a leaf and its path; true when it matches `expectedRoot`. */
export function verifyInclusion(proof: Pick<InclusionProof, "leaf" | "path">, expectedRoot: string): boolean {
  let acc = leafHash(proof.leaf);
  for (const step of proof.path) {
    const sib = hexToBytes(step.hash);
    acc = step.side === "L" ? nodeHash(sib, acc) : nodeHash(acc, sib);
  }
  return bytesToHex(acc) === expectedRoot.toLowerCase();
}

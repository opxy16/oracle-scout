import "server-only";
import { createDecipheriv } from "node:crypto";
import { hashObject, proofForEntry, type LogEntry } from "@oracle-scout/ledger";
import { ledgerFile, loadLedger } from "./ledger";

interface SealedBox {
  iv: string;
  tag: string;
  data: string;
}

function unseal(box: SealedBox, keyB64: string): string {
  const d = createDecipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), Buffer.from(box.iv, "base64"));
  d.setAuthTag(Buffer.from(box.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(box.data, "base64")), d.final()]).toString("utf8");
}

export interface EvidencePack {
  format: "oracle-scout/evidence-pack@1";
  marketId: string;
  question: string;
  items: Record<string, unknown>[];
  integrity: {
    itemHash: string;
    loggedHash?: string;
    matchesLog: boolean;
    logEntry?: { seq: number; entryHash: string; ts: string };
    anchor?: { root: string; txHash: string; explorerUrl?: string; fromSeq: number; toSeq: number };
    proof?: unknown;
  }[];
  howToVerify: string[];
}

/** Decrypt a published pack and attach, for every item, the audit-log entry and Merkle proof that committed to it. */
export async function openPack(marketId: string): Promise<EvidencePack | null> {
  const key = process.env.OS_PACK_KEY;
  if (!key) throw new Error("OS_PACK_KEY not configured");
  const { packs, entries } = await loadLedger();
  const meta = packs.find((p) => p.marketId === marketId);
  if (!meta) return null;
  const raw = await ledgerFile(meta.file);
  if (!raw) return null;
  const { sealed } = JSON.parse(raw) as { sealed: SealedBox };
  const body = JSON.parse(unseal(sealed, key)) as { marketId: string; question: string; items: (Record<string, unknown> & { id: string; contentHash?: string })[] };

  const created = new Map<string, LogEntry>();
  for (const e of entries) if (e.kind === "evidence.created") created.set(String((e.payload as { evidenceId: string }).evidenceId), e);

  const integrity = body.items.map((it) => {
    const { contentHash, ...rest } = it;
    const itemHash = hashObject(rest);
    const entry = created.get(it.id);
    const loggedHash = (entry?.payload as { contentHash?: string } | undefined)?.contentHash;
    const p = entry ? proofForEntry(entries, entry.seq) : null;
    return {
      itemHash,
      loggedHash,
      matchesLog: Boolean(loggedHash && loggedHash === itemHash && contentHash === itemHash),
      logEntry: entry ? { seq: entry.seq, entryHash: entry.entryHash, ts: entry.ts } : undefined,
      anchor: p ? { root: p.anchor.root, txHash: p.anchor.txHash, explorerUrl: p.anchor.explorerUrl, fromSeq: p.anchor.fromSeq, toSeq: p.anchor.toSeq } : undefined,
      proof: p?.proof,
    };
  });

  return {
    format: "oracle-scout/evidence-pack@1",
    marketId,
    question: body.question,
    items: body.items,
    integrity,
    howToVerify: [
      "itemHash = sha256 of the item's canonical JSON (keys sorted, no whitespace, contentHash field removed).",
      "loggedHash is what the agent wrote into its audit log when it created the item; they must match.",
      "The log entry's Merkle proof recomputes to anchor.root (RFC 6962 hashing: leaf 0x00||entryHash, node 0x01||L||R).",
      "anchor.txHash is a Concordium RegisterData transaction whose memo contains that root, finalized before the market resolved.",
      "Each fact's dataUrl + contentHash lets you re-fetch the primary source and compare.",
    ],
  };
}

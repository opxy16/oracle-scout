import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AnchorRecord, LogEntry } from "@oracle-scout/ledger";

/** Shapes written by `npm run agent -- publish` (apps/agent/src/publish.ts). */
export interface PublicAgent {
  name: string;
  agentId: string;
  description: string;
  network: string;
  ownerAccount?: string;
  registry?: { tokenId?: string; badge?: string; contract: string };
  publicUrl?: string;
  packPriceMicroCcd: string;
  updatedAt: string;
}

export interface PackIndexEntry {
  marketId: string;
  question: string;
  stance: string;
  probability: number;
  items: number;
  itemHashes: string[];
  evidenceIds: string[];
  firstAt: string;
  lastAt: string;
  submittedLive: boolean;
  file: string;
}

export interface Ledger {
  agent: PublicAgent | null;
  entries: LogEntry[];
  anchors: AnchorRecord[];
  packs: PackIndexEntry[];
  source: string;
}

const REMOTE = process.env.LEDGER_BASE_URL ?? "https://raw.githubusercontent.com/opxy16/oracle-scout/main/ledger";
const LOCAL = process.env.LEDGER_DIR ?? join(process.cwd(), "..", "..", "ledger");

/** Read a published ledger file: local checkout first in development, the public repo otherwise. */
export async function ledgerFile(path: string): Promise<string | null> {
  if (process.env.NODE_ENV !== "production" || process.env.LEDGER_DIR) {
    try {
      return await readFile(join(LOCAL, path), "utf8");
    } catch {
      /* fall through to remote */
    }
  }
  try {
    const res = await fetch(`${REMOTE}/${path}`, { next: { revalidate: 60 } });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

export async function loadLedger(): Promise<Ledger> {
  const [agentTxt, logTxt, packsTxt] = await Promise.all([ledgerFile("agent.json"), ledgerFile("audit-log.jsonl"), ledgerFile("packs/index.json")]);
  const entries = (logTxt ?? "")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as LogEntry);
  return {
    agent: agentTxt ? (JSON.parse(agentTxt) as PublicAgent) : null,
    entries,
    anchors: entries.filter((e) => e.kind === "anchor").map((e) => e.payload as AnchorRecord),
    packs: packsTxt ? (JSON.parse(packsTxt) as PackIndexEntry[]) : [],
    source: process.env.NODE_ENV !== "production" ? "local ./ledger" : REMOTE,
  };
}

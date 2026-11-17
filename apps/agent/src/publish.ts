import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvidenceItem } from "@oracle-scout/evidence";
import { seal } from "@oracle-scout/ledger/node";
import type { AgentConfig } from "./config.js";
import type { AgentState } from "./state.js";

/** Public, git-published view of the agent: what the dashboard, MCP and A2A endpoints read. */
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

export const safeName = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);

export async function publish(cfg: AgentConfig, state: AgentState, outDir: string, env = process.env): Promise<{ packs: number; entries: number }> {
  const key = env.OS_PACK_KEY;
  if (!key) throw new Error("OS_PACK_KEY is not set: run `npm run agent -- keygen` first");
  await mkdir(join(outDir, "packs"), { recursive: true });

  const logPath = join(cfg.dataDir, "audit-log.jsonl");
  await copyFile(logPath, join(outDir, "audit-log.jsonl"));
  const entries = (await readFile(logPath, "utf8")).split("\n").filter(Boolean).length;

  const subs = await state.submissions();
  const live = new Set(subs.filter((s) => !s.dryRun).map((s) => s.evidenceId));
  const files = await readdir(join(cfg.dataDir, "evidence")).catch(() => [] as string[]);
  const items: EvidenceItem[] = [];
  for (const f of files) if (f.endsWith(".json")) items.push(JSON.parse(await readFile(join(cfg.dataDir, "evidence", f), "utf8")) as EvidenceItem);

  const byMarket = new Map<string, EvidenceItem[]>();
  for (const it of items) byMarket.set(it.marketId, [...(byMarket.get(it.marketId) ?? []), it]);

  const index: PackIndexEntry[] = [];
  for (const [marketId, list] of byMarket) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const last = list[list.length - 1]!;
    const file = `packs/${safeName(marketId)}.json`;
    const sealed = seal(JSON.stringify({ marketId, question: last.question, items: list }), key);
    await writeFile(join(outDir, file), JSON.stringify({ marketId, sealed }));
    index.push({
      marketId,
      question: last.question,
      stance: last.stance,
      probability: last.probability,
      items: list.length,
      itemHashes: list.map((i) => i.contentHash ?? ""),
      evidenceIds: list.map((i) => i.id),
      firstAt: list[0]!.createdAt,
      lastAt: last.createdAt,
      submittedLive: list.some((i) => live.has(i.id)),
      file,
    });
  }
  index.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  await writeFile(join(outDir, "packs", "index.json"), JSON.stringify(index, null, 2));

  const agent: PublicAgent = {
    name: cfg.agentName,
    agentId: cfg.agentId,
    description: "Data-first evidence agent: pulls official data series, computes the odds, and submits dated, quoted, sourced evidence. Every step is hash-chained and anchored on Concordium.",
    network: `concordium:${cfg.anchor.network}`,
    ownerAccount: env.OS_OWNER_ACCOUNT || undefined,
    registry: { tokenId: env.OS_REGISTRY_TOKEN_ID || undefined, badge: env.OS_REGISTRY_BADGE || undefined, contract: cfg.anchor.network === "mainnet" ? "<10082,0>" : "<12802,0>" },
    publicUrl: env.OS_PUBLIC_URL || undefined,
    packPriceMicroCcd: env.OS_PACK_PRICE_MICROCCD || "2000000",
    updatedAt: new Date().toISOString(),
  };
  await writeFile(join(outDir, "agent.json"), JSON.stringify(agent, null, 2));
  return { packs: index.length, entries };
}

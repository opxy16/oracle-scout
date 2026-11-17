import "server-only";
import { proofForEntry, verifyChain } from "@oracle-scout/ledger";
import { loadLedger } from "./ledger";
import { summarize } from "./view";

/** Tool layer shared by the MCP and A2A endpoints. Read-only; payments go through the x402 HTTP route. */

const BADGE_API = "https://agent-registry-mcp.concordium.com/v1/check-badge";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>, ctx: { origin: string }): Promise<unknown>;
}

const str = (v: unknown) => (typeof v === "string" ? v : v === undefined ? "" : String(v));

export const TOOLS: ToolDef[] = [
  {
    name: "get_agent_identity",
    description: "Who Oracle Scout is: registry entry (CIS-8004 token and badge), owner account, network, endpoints, and how to verify the badge independently.",
    inputSchema: { type: "object", properties: {} },
    async run(_a, { origin }) {
      const { agent, entries, anchors } = await loadLedger();
      return {
        agent,
        endpoints: { mcp: `${origin}/api/mcp`, a2a: `${origin}/api/a2a`, agentCard: `${origin}/.well-known/agent-card.json`, packs: `${origin}/api/packs/{marketId}`, article12: `${origin}/api/export/article12` },
        auditLog: { entries: entries.length, anchors: anchors.length, lastAnchor: anchors.at(-1) ?? null },
        verifyBadge: agent?.registry?.badge ? `${BADGE_API}/${agent.registry.badge}?network=testnet` : "registration pending",
      };
    },
  },
  {
    name: "check_badge",
    description: "Check a Verified by Concordium badge (defaults to Oracle Scout's own) against the Concordium Agent Registry. Use before paying any agent.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Badge token address or Concordium account (base58). Optional." } } },
    async run(a) {
      const { agent } = await loadLedger();
      const id = str(a.id) || agent?.registry?.badge;
      if (!id) return { error: "No badge id given and Oracle Scout's registration is pending" };
      const res = await fetch(`${BADGE_API}/${encodeURIComponent(id)}?network=testnet`, { cache: "no-store" });
      return { id, status: res.status, result: await res.json().catch(() => null) };
    },
  },
  {
    name: "list_evidence",
    description: "List markets Oracle Scout has evidence on: question, stance (YES/NO), its probability, item count and content hashes. Optional keyword filter.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } } },
    async run(a) {
      const { packs } = await loadLedger();
      const q = str(a.query).toLowerCase();
      const words = q.split(/\s+/).filter(Boolean);
      const hits = packs.filter((p) => words.every((w) => p.question.toLowerCase().includes(w)));
      return hits.slice(0, Number(a.limit ?? 20)).map(({ file: _f, ...p }) => p);
    },
  },
  {
    name: "get_evidence_trail",
    description: "The audit-log entries for one market (fetches, analysis, creation, submission, receipts) with hashes. The full evidence text is in the paid pack.",
    inputSchema: { type: "object", properties: { marketId: { type: "string" } }, required: ["marketId"] },
    async run(a) {
      const { entries } = await loadLedger();
      const id = str(a.marketId);
      return entries
        .filter((e) => (e.payload as { marketId?: string } | undefined)?.marketId === id)
        .map((e) => ({ seq: e.seq, ts: e.ts, kind: e.kind, summary: summarize(e), entryHash: e.entryHash }));
    },
  },
  {
    name: "verify_log_entry",
    description: "Merkle inclusion proof for audit-log entry `seq` against the root anchored on Concordium, plus a full hash-chain check.",
    inputSchema: { type: "object", properties: { seq: { type: "number" } }, required: ["seq"] },
    async run(a) {
      const { entries } = await loadLedger();
      const seq = Number(a.seq);
      const entry = entries[seq];
      if (!entry) return { error: `No entry ${seq}` };
      const chain = verifyChain(entries);
      const p = proofForEntry(entries, seq);
      return { entry: { ...entry, payload: undefined }, chainValid: chain.ok, anchored: Boolean(p), anchor: p?.anchor ?? null, proof: p?.proof ?? null };
    },
  },
  {
    name: "get_pack_offer",
    description: "Price and x402 payment instructions for the full evidence pack on a market (Concordium testnet, CCD, fees sponsored).",
    inputSchema: { type: "object", properties: { marketId: { type: "string" } }, required: ["marketId"] },
    async run(a, { origin }) {
      const { packs, agent } = await loadLedger();
      const p = packs.find((x) => x.marketId === str(a.marketId));
      if (!p) return { error: "No pack for that market" };
      return {
        url: `${origin}/api/packs/${encodeURIComponent(p.marketId)}`,
        priceMicroCcd: agent?.packPriceMicroCcd ?? "2000000",
        network: "ccd:4221332d34e1694168c2a0c0b3fd0f27",
        protocol: "x402 v2, scheme exact, Concordium sponsored transaction",
        steps: [
          "GET the url: expect HTTP 402 with a PAYMENT-REQUIRED header (base64 JSON).",
          "Check the seller's badge first (tool check_badge).",
          "Build a CCD transfer to payTo with sponsor = extra.feePayer, sign as sender (@x402/concordium client).",
          "Retry with header PAYMENT-SIGNATURE; read PAYMENT-RESPONSE for the settlement tx hash.",
        ],
        contents: { items: p.items, itemHashes: p.itemHashes, stance: p.stance },
      };
    },
  },
];

export async function runTool(name: string, args: Record<string, unknown>, origin: string): Promise<unknown> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`Unknown tool: ${name}`);
  return t.run(args, { origin });
}

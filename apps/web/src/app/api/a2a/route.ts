import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { runTool } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A2A JSON-RPC endpoint (message/send). Send a text part with a question or keywords;
 * Oracle Scout answers with the matching evidence summaries as a data part, plus how to
 * buy the full packs over x402. Data parts { tool, arguments } call a tool directly.
 */
type Part = { kind?: string; type?: string; text?: string; data?: Record<string, unknown> };

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const rpc = (await req.json().catch(() => null)) as { id?: unknown; method?: string; params?: { message?: { parts?: Part[]; contextId?: string } } } | null;
  const reply = (result: unknown) => NextResponse.json({ jsonrpc: "2.0", id: rpc?.id ?? null, result });
  if (!rpc || (rpc.method !== "message/send" && rpc.method !== "SendMessage")) {
    return NextResponse.json({ jsonrpc: "2.0", id: rpc?.id ?? null, error: { code: -32601, message: "Only message/send is supported" } });
  }
  const parts = rpc.params?.message?.parts ?? [];
  const dataPart = parts.find((p) => p.data && typeof p.data.tool === "string");
  let out: unknown;
  let text: string;
  if (dataPart?.data) {
    out = await runTool(String(dataPart.data.tool), (dataPart.data.arguments as Record<string, unknown>) ?? {}, origin);
    text = `Result of ${dataPart.data.tool}.`;
  } else {
    const query = parts.map((p) => p.text ?? "").join(" ").trim();
    const STOP = new Set(["will", "the", "be", "a", "an", "of", "on", "by", "in", "what", "do", "you", "have", "about", "is", "for", "any", "evidence"]);
    const keywords = query.toLowerCase().replace(/[^a-z0-9$.% ]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)).slice(0, 4);
    const hits = (await runTool("list_evidence", { query: keywords.join(" ") }, origin)) as unknown[];
    out = { query, keywords, evidence: hits, buy: `${origin}/api/packs/{marketId} (x402, CCD on Concordium testnet)` };
    text = hits.length ? `I have evidence on ${hits.length} matching market(s). Summaries attached; full packs are sold over x402.` : "No evidence on that yet. I only cover questions an official data series can settle.";
  }
  return reply({
    kind: "message",
    messageId: randomUUID(),
    role: "agent",
    contextId: rpc.params?.message?.contextId ?? randomUUID(),
    parts: [
      { kind: "text", text },
      { kind: "data", data: out as Record<string, unknown> },
    ],
  });
}

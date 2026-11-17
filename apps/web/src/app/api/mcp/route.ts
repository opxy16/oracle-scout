import { NextResponse } from "next/server";
import { runTool, TOOLS } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Minimal stateless MCP server (Streamable HTTP transport, JSON responses).
 * Same shape as Concordium's hosted Agent Registry MCP, so the same client config works:
 *   { "mcpServers": { "oracle-scout": { "url": "https://<host>/api/mcp" } } }
 */
const SERVER_INFO = { name: "oracle-scout", version: "0.1.0" };
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

async function handle(msg: Rpc, origin: string): Promise<object | null> {
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id ?? null, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  if (msg.id === undefined || msg.id === null) return null; // notification: no response
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return ok({
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Oracle Scout is an accountable evidence agent on Concordium. Call get_agent_identity and check_badge first; list_evidence to discover markets; get_pack_offer to buy a full pack over x402.",
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      try {
        const out = await runTool(name, (msg.params?.arguments as Record<string, unknown>) ?? {}, origin);
        return ok({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: typeof out === "object" && !Array.isArray(out) ? out : { items: out }, isError: false });
      } catch (e) {
        return ok({ content: [{ type: "text", text: (e as Error).message }], isError: true });
      }
    }
    default:
      return err(-32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  let body: Rpc | Rpc[];
  try {
    body = (await req.json()) as Rpc | Rpc[];
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m, origin)))).filter(Boolean);
    return out.length ? NextResponse.json(out) : new NextResponse(null, { status: 202 });
  }
  const out = await handle(body, origin);
  return out ? NextResponse.json(out) : new NextResponse(null, { status: 202 });
}

export async function GET() {
  return NextResponse.json({ name: SERVER_INFO.name, transport: "streamable-http (stateless, JSON)", usage: "POST JSON-RPC 2.0 here", tools: TOOLS.map((t) => t.name) }, { status: 200 });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

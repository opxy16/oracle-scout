import { createHash } from "node:crypto";
import { REGISTRY_MCP_URL, REGISTRY_REST_URL } from "./network.js";

/**
 * Thin client for Concordium's hosted Agent Registry MCP (stateless JSON-RPC, no auth).
 * The service never holds keys: build_* tools return sign-ready contract parameters.
 * Every call passes network explicitly because the hosted default is mainnet.
 */
export class RegistryMcp {
  private id = 0;
  constructor(
    readonly network: "testnet" | "mainnet" = "testnet",
    private readonly url = REGISTRY_MCP_URL,
    private readonly f: typeof fetch = fetch,
  ) {}

  async call<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const res = await this.f(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method: "tools/call", params: { name, arguments: { network: this.network, ...args } } }),
    });
    const text = await res.text();
    const json = JSON.parse(text.startsWith("event:") || text.startsWith("data:") ? text.split("\n").find((l) => l.startsWith("data:"))!.slice(5) : text) as {
      result?: { content: { type: string; text: string }[]; isError?: boolean };
      error?: { message: string };
    };
    if (json.error) throw new Error(`${name}: ${json.error.message}`);
    const body = json.result?.content.find((c) => c.type === "text")?.text ?? "{}";
    if (json.result?.isError) throw new Error(`${name}: ${body}`);
    try {
      return JSON.parse(body) as T;
    } catch {
      return { text: body } as T;
    }
  }

  buildAgentCard(a: { name: string; description: string; agent_uri: string; owner_account: string; skills: { id: string; name: string; description: string; tags: string[] }[]; services?: Record<string, string>; token_id?: number | null }) {
    return this.call<{ agent_card_json: string | Record<string, unknown>; metadata_hash_hex: string }>("build_agent_card", a);
  }

  buildRegister(a: { sender: string; agent_uri: string; metadata_hash_hex: string }) {
    return this.call<BuiltUpdate>("build_register", a);
  }

  buildAgentBadge(a: { owner_account: string; token_id: number; card_json?: string; card_url?: string }) {
    return this.call<Record<string, unknown>>("build_agent_badge", a);
  }

  buildSetAgentUri(a: { token_id: number; sender: string; metadata_hash_hex: string; agent_uri?: string }) {
    return this.call<BuiltUpdate>("build_set_agent_uri", a);
  }

  agentsByOwner(owner: string) {
    return this.call<Record<string, unknown>>("agents_by_owner", { owner_account: owner });
  }

  tokenAddress(tokenId: number) {
    return this.call<Record<string, unknown>>("token_address", { token_id: tokenId });
  }

  checkBadge(id: string) {
    return this.call<BadgeCheck>("check_badge", { id });
  }

  verifyAgentCard(tokenId: number) {
    return this.call<Record<string, unknown>>("verify_agent_card", { token_id: tokenId });
  }
}

export interface BuiltUpdate {
  network: string;
  contract_address: { index: number; subindex: number };
  receive_name: string;
  parameter_hex: string;
  suggested_energy?: number;
  sender?: string;
}

export interface BadgeCheck {
  badge_valid?: boolean;
  extension_conformant?: boolean;
  verification_present?: boolean;
  issues?: string[];
  [k: string]: unknown;
}

/** REST badge check (CORS *, usable from a browser). Account ids need ?network=testnet. */
export async function checkBadgeRest(id: string, network: "testnet" | "mainnet" = "testnet", f: typeof fetch = fetch): Promise<BadgeCheck> {
  const res = await f(`${REGISTRY_REST_URL}/v1/check-badge/${encodeURIComponent(id)}?network=${network}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`check-badge ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as BadgeCheck;
}

/** sha256 of the exact served bytes — what the registry pins as metadata_hash. */
export async function hashServedCard(url: string, f: typeof fetch = fetch): Promise<{ hash: string; bytes: number }> {
  const res = await f(url, { headers: { accept: "application/json" }, cache: "no-store" } as RequestInit);
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { hash: createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
}

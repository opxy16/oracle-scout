/**
 * Register Oracle Scout in the Concordium Agent Registry (CIS-8004, testnet) and earn the
 * Verified by Concordium badge. Two passes, because the token id only exists after minting:
 *
 *   npm run register -- card       write the pre-mint Agent Card to apps/web/public/.well-known/agent-card.json
 *   (deploy the web app so the card is served at OS_PUBLIC_URL)
 *   npm run register -- register   hash the served card, mint the agent NFT (signed with keys/agent.export)
 *   npm run register -- card       rebuild the card with the token id + badge, write it again
 *   (deploy again)
 *   npm run register -- pin        pin the new card hash on chain (setAgentURI)
 *   npm run register -- check      check the badge through the registry's public API
 *
 * Keys: only the wallet export path from .env is used; nothing secret is printed.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { RegistryMcp, TESTNET, checkBadgeRest, grpcClient, hashServedCard, loadWalletExport, updateContract } from "@oracle-scout/concordium";

for (const f of [".env", ".env.local"]) if (existsSync(f)) (process as unknown as { loadEnvFile(p: string): void }).loadEnvFile(f);

const PUBLIC_URL = (process.env.OS_PUBLIC_URL ?? "").replace(/\/$/, "");
const CARD_FILE = resolve("apps/web/public/.well-known/agent-card.json");
const STATE_FILE = resolve("data/registry.json");
const mcp = new RegistryMcp("testnet");

type State = { tokenId?: number; badge?: string; owner?: string; registerTx?: string; pinTx?: string; cardHash?: string };
const state = (): State => (existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as State) : {});
const save = (s: State) => {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
};

function owner() {
  const path = process.env.CONCORDIUM_AGENT_WALLET;
  if (!path) throw new Error("Set CONCORDIUM_AGENT_WALLET in .env (path to the agent account's wallet export)");
  return loadWalletExport(path);
}

const SKILLS = [
  { id: "primary-data-evidence", name: "Primary-data evidence", description: "Dated, quoted, sourced evidence for yes/no forecasting questions that an official data series can settle (CPI, jobs, rates, debt, crypto prices, weather).", tags: ["forecasting", "evidence", "data"] },
  { id: "evidence-packs", name: "Evidence packs over x402", description: "Full evidence bundle per market with raw quotes, model inputs, and Merkle proofs against Concordium anchors. Paid in CCD via x402.", tags: ["x402", "payments", "concordium"] },
  { id: "audit-proofs", name: "Audit-log proofs", description: "Hash-chained audit log with Merkle roots anchored on Concordium; EU AI Act Article 12-style export.", tags: ["accountability", "audit", "eu-ai-act"] },
];

async function card() {
  if (!PUBLIC_URL) throw new Error("Set OS_PUBLIC_URL (where the web app is deployed)");
  const s = state();
  const acct = owner();
  const agentUri = `${PUBLIC_URL}/.well-known/agent-card.json`;
  const built = await mcp.buildAgentCard({
    name: "Oracle Scout",
    description:
      "Accountable evidence agent. Reads official data series, computes the odds, and submits dated, quoted, sourced evidence to forecasting markets. Every step is hash-chained and anchored on Concordium; full evidence packs are sold over x402.",
    agent_uri: agentUri,
    owner_account: acct.address,
    skills: SKILLS,
    services: { mcp: `${PUBLIC_URL}/api/mcp`, a2a: `${PUBLIC_URL}/api/a2a`, x402: `${PUBLIC_URL}/api/packs/{marketId}`, auditLog: `${PUBLIC_URL}/api/ledger` },
    token_id: s.tokenId ?? null,
  } as never);
  const base = (typeof built.agent_card_json === "string" ? JSON.parse(built.agent_card_json) : built.agent_card_json) as Record<string, unknown>;
  // ERC-8004 registration-file fields (allowed alongside the A2A card)
  const cardJson = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    ...base,
    image: `${PUBLIC_URL}/cover.png`,
    provider: { organization: "Oracle Scout", url: "https://github.com/opxy16/oracle-scout" },
    documentationUrl: "https://github.com/opxy16/oracle-scout#readme",
    supportedInterfaces: [{ url: `${PUBLIC_URL}/api/a2a`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
    services: [
      { name: "A2A", endpoint: agentUri, version: "1.0" },
      { name: "MCP", endpoint: `${PUBLIC_URL}/api/mcp`, version: "2025-06-18" },
    ],
    x402Support: true,
    active: true,
  };
  const bytes = JSON.stringify(cardJson, null, 2) + "\n";
  mkdirSync(dirname(CARD_FILE), { recursive: true });
  writeFileSync(CARD_FILE, bytes);
  const hash = createHash("sha256").update(bytes).digest("hex");
  save({ ...s, owner: acct.address, cardHash: hash, badge: (built as { token_address?: string }).token_address ?? s.badge });
  console.log(`Wrote ${CARD_FILE}\n  sha256 ${hash}\n  ${s.tokenId === undefined ? "pre-mint card" : `card for token #${s.tokenId}`}. Deploy it so it is served at ${agentUri}, then run: npm run register -- ${s.tokenId === undefined ? "register" : "pin"}`);
}

async function servedHash(): Promise<string> {
  const url = `${PUBLIC_URL}/.well-known/agent-card.json`;
  const { hash } = await hashServedCard(url);
  const local = createHash("sha256").update(readFileSync(CARD_FILE)).digest("hex");
  if (hash !== local) throw new Error(`Served card (${hash.slice(0, 12)}…) differs from local file (${local.slice(0, 12)}…). Deploy first.`);
  return hash;
}

async function register() {
  const s = state();
  if (s.tokenId !== undefined) throw new Error(`Already registered as token #${s.tokenId}`);
  const acct = owner();
  const hash = await servedHash();
  const built = await mcp.buildRegister({ sender: acct.address, agent_uri: `${PUBLIC_URL}/.well-known/agent-card.json`, metadata_hash_hex: hash });
  console.log(`Submitting register to CIS-8004 ${built.contract_address.index}.${built.contract_address.subindex} from ${acct.address}…`);
  const tx = await updateContract(grpcClient(TESTNET), TESTNET, acct, built);
  console.log(`  finalized: ${tx.explorerUrl}`);
  const mine = (await mcp.agentsByOwner(acct.address)) as { agents?: { token_id: number | string; agent_uri?: string }[] };
  const ids = (mine.agents ?? []).map((a) => Number(a.token_id)).sort((a, b) => b - a);
  const tokenId = ids[0];
  if (tokenId === undefined) throw new Error("Registered, but the indexer has not caught up yet. Run `npm run register -- find` in a minute.");
  save({ ...s, owner: acct.address, tokenId, registerTx: tx.txHash });
  console.log(`  agent token #${tokenId}. Now run: npm run register -- card   (then deploy, then: npm run register -- pin)`);
}

async function find() {
  const s = state();
  const acct = owner();
  const mine = await mcp.agentsByOwner(acct.address);
  console.log(JSON.stringify(mine, null, 2));
  const ids = ((mine as { agents?: { token_id: number | string }[] }).agents ?? []).map((a) => Number(a.token_id)).sort((a, b) => b - a);
  if (ids[0] !== undefined && s.tokenId === undefined) save({ ...s, tokenId: ids[0] });
}

async function pin() {
  const s = state();
  if (s.tokenId === undefined) throw new Error("Register first");
  const acct = owner();
  const hash = await servedHash();
  const built = await mcp.buildSetAgentUri({ token_id: s.tokenId, sender: acct.address, metadata_hash_hex: hash });
  const tx = await updateContract(grpcClient(TESTNET), TESTNET, acct, built);
  save({ ...s, pinTx: tx.txHash, cardHash: hash });
  console.log(`Pinned card hash ${hash.slice(0, 16)}… for token #${s.tokenId}: ${tx.explorerUrl}\nNow: npm run register -- check`);
}

async function check() {
  const s = state();
  const id = s.badge ?? ((await mcp.tokenAddress(s.tokenId!)) as { token_address?: string; base58?: string }).token_address;
  if (!id) throw new Error("No badge id yet");
  const r = await checkBadgeRest(id, "testnet");
  console.log(JSON.stringify(r, null, 2));
  save({ ...s, badge: id });
  console.log(`\nAdd to .env:  OS_REGISTRY_TOKEN_ID=${s.tokenId}  OS_REGISTRY_BADGE=${id}  OS_OWNER_ACCOUNT=${s.owner}`);
}

const cmds: Record<string, () => Promise<void>> = { card, register, find, pin, check };
const cmd = process.argv[2] ?? "";
(cmds[cmd] ?? (async () => console.log("usage: npm run register -- card | register | find | pin | check")))().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});

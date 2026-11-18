import "server-only";
import { grpcClient, TESTNET, verifyOwnerProof, type OwnerProofResult, type ProofContext } from "@oracle-scout/concordium";
import { ledgerFile, loadLedger } from "./ledger";

export const MIN_AGE = 18;
/** Testnet identity providers accepted for the owner proof (0 = Concordium testnet IP, 3 = Digital Trust Solutions TestNet, 5 = Dataspike). */
export const IDENTITY_PROVIDERS = [0, 3, 5];

export function proofSecret(): string {
  const k = process.env.OS_PACK_KEY;
  if (!k) throw new Error("OS_PACK_KEY not configured");
  return k;
}

/** Owner account + registry token come from the published agent identity, falling back to env. */
export async function agentOwner(): Promise<{ owner: string; tokenId: number; badge?: string }> {
  const { agent } = await loadLedger();
  const owner = agent?.ownerAccount ?? process.env.OS_OWNER_ACCOUNT ?? process.env.OS_PAYTO;
  const tokenId = Number(agent?.registry?.tokenId ?? process.env.OS_REGISTRY_TOKEN_ID);
  if (!owner || !Number.isFinite(tokenId)) throw new Error("Agent owner / registry token not known yet");
  return { owner, tokenId, badge: agent?.registry?.badge ?? process.env.OS_REGISTRY_BADGE };
}

export interface StoredOwnerProof {
  format: "oracle-scout/owner-proof-record@1";
  ctx: ProofContext;
  sig: string;
  presentation: string;
  result: OwnerProofResult;
}

export async function verifyStored(): Promise<{ present: false } | { present: true; record: Omit<StoredOwnerProof, "presentation">; live: OwnerProofResult }> {
  const raw = await ledgerFile("owner-proof.json");
  if (!raw) return { present: false };
  const rec = JSON.parse(raw) as StoredOwnerProof;
  const { owner } = await agentOwner();
  const live = await verifyOwnerProof({
    presentation: rec.presentation,
    ctx: rec.ctx,
    sig: rec.sig,
    secret: proofSecret(),
    expectedOwner: owner,
    client: grpcClient(TESTNET),
    network: TESTNET,
  });
  const { presentation: _p, ...record } = rec;
  return { present: true, record, live };
}

import type { AnchorRecord, PendingBatch } from "@oracle-scout/ledger";
import { anchorMemo, grpcClient, loadWalletExport, registerData } from "./chain.js";
import { networkByName } from "./network.js";

export * from "./network.js";
export * from "./chain.js";
export * from "./registry.js";
export * from "./x402.js";

export interface Anchorer {
  network: string;
  anchor(batch: PendingBatch, agentId: string): Promise<Pick<AnchorRecord, "txHash" | "explorerUrl">>;
}

/**
 * Anchors audit-log Merkle roots with a RegisterData transaction signed by the agent's account.
 * Env: CONCORDIUM_NETWORK (testnet), CONCORDIUM_AGENT_WALLET (path to the Concordium Wallet key export, git-ignored).
 */
export async function concordiumAnchorerFromEnv(env: NodeJS.ProcessEnv): Promise<Anchorer> {
  const path = env.CONCORDIUM_AGENT_WALLET;
  if (!path) throw new Error("CONCORDIUM_AGENT_WALLET is not set");
  const n = networkByName(env.CONCORDIUM_NETWORK);
  const account = loadWalletExport(path);
  const client = grpcClient(n);
  return {
    network: `concordium:${n.name}`,
    async anchor(batch, agentId) {
      const sent = await registerData(client, n, account, anchorMemo(agentId, batch));
      return { txHash: sent.txHash, explorerUrl: sent.explorerUrl };
    },
  };
}

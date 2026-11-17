import type { AnchorRecord, PendingBatch } from "@oracle-scout/ledger";

export interface Anchorer {
  network: string;
  anchor(batch: PendingBatch, agentId: string): Promise<Pick<AnchorRecord, "txHash" | "explorerUrl">>;
}

export async function concordiumAnchorerFromEnv(_env: NodeJS.ProcessEnv): Promise<Anchorer> {
  throw new Error("Concordium anchoring not implemented yet");
}

/** Concordium network constants (testnet first; mainnet listed for the path to production). */
export interface CcdNetwork {
  name: "testnet" | "mainnet";
  caip2: string;
  grpcHost: string;
  grpcPort: number;
  explorer: string;
  cis8004: { index: bigint; subindex: bigint };
  cis8: { index: bigint; subindex: bigint };
}

export const TESTNET: CcdNetwork = {
  name: "testnet",
  caip2: "ccd:4221332d34e1694168c2a0c0b3fd0f27",
  grpcHost: "grpc.testnet.concordium.com",
  grpcPort: 20000,
  explorer: "https://ccdexplorer.io/testnet",
  cis8004: { index: 12802n, subindex: 0n },
  cis8: { index: 12801n, subindex: 0n },
};

export const MAINNET: CcdNetwork = {
  name: "mainnet",
  caip2: "ccd:9dd9ca4d19e9393877d2c44b70f89acb",
  grpcHost: "grpc.mainnet.concordium.software",
  grpcPort: 20000,
  explorer: "https://ccdexplorer.io/mainnet",
  cis8004: { index: 10082n, subindex: 0n },
  cis8: { index: 10081n, subindex: 0n },
};

export function networkByName(name = "testnet"): CcdNetwork {
  return name === "mainnet" ? MAINNET : TESTNET;
}

export const REGISTRY_MCP_URL = "https://agent-registry-mcp.concordium.com/mcp";
export const REGISTRY_REST_URL = "https://agent-registry-mcp.concordium.com";
export const BADGE_EXTENSION_URI = "https://docs.concordium.com/a2a-extensions/concordium-badge/v1";

export const explorerTx = (n: CcdNetwork, hash: string) => `${n.explorer}/transaction/${hash}`;
export const explorerAccount = (n: CcdNetwork, addr: string) => `${n.explorer}/account/${addr}`;

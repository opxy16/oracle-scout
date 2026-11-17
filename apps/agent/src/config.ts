import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Load .env files without a dependency (Node >= 20.12 has process.loadEnvFile). */
export function loadEnv(root = process.cwd()): void {
  for (const f of [".env", ".env.local"]) {
    const p = resolve(root, f);
    if (existsSync(p)) (process as unknown as { loadEnvFile(p: string): void }).loadEnvFile(p);
  }
}

const num = (v: string | undefined, d: number) => (v === undefined || v === "" ? d : Number(v));

export interface AgentConfig {
  agentId: string;
  agentName: string;
  harness: string;
  model: string;
  dataDir: string;
  dryRun: boolean;
  delphi: { baseUrl: string; apiKey?: string; marketsFile?: string };
  limits: {
    maxPerMarket: number;
    maxPerRun: number;
    maxPerDay: number;
    minPlanConfidence: number;
    yesAt: number;
    noAt: number;
    minEdge: number;
    /** Do not submit in the last N minutes before an evidence cutoff (receipts can lag). */
    cutoffBufferMin: number;
  };
  anchor: { everyEntries: number; network: string };
}

export function readConfig(env = process.env): AgentConfig {
  return {
    agentId: env.OS_AGENT_ID ?? "oracle-scout",
    agentName: env.OS_AGENT_NAME ?? "Oracle Scout",
    harness: env.OS_HARNESS ?? "oracle-scout/0.1 (node)",
    model: env.OS_MODEL ?? "deterministic-data-pipeline",
    dataDir: resolve(env.OS_DATA_DIR ?? "data"),
    dryRun: env.OS_DRY_RUN !== "0",
    delphi: { baseUrl: env.DELPHI_API_BASE ?? "", apiKey: env.DELPHI_API_KEY || undefined, marketsFile: env.DELPHI_MARKETS_FILE },
    limits: {
      maxPerMarket: num(env.OS_MAX_PER_MARKET, 3),
      maxPerRun: num(env.OS_MAX_PER_RUN, 5),
      maxPerDay: num(env.OS_MAX_PER_DAY, 15),
      minPlanConfidence: num(env.OS_MIN_PLAN_CONFIDENCE, 0.7),
      yesAt: num(env.OS_YES_AT, 0.8),
      noAt: num(env.OS_NO_AT, 0.2),
      minEdge: num(env.OS_MIN_EDGE, 0.1),
      cutoffBufferMin: num(env.OS_CUTOFF_BUFFER_MIN, 30),
    },
    anchor: { everyEntries: num(env.OS_ANCHOR_EVERY, 25), network: env.CONCORDIUM_NETWORK ?? "testnet" },
  };
}

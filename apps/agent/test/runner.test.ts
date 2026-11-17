import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fakeHttp, type Market } from "@oracle-scout/evidence";
import { AuditLog, MemoryStore, verifyChain } from "@oracle-scout/ledger";
import { readConfig } from "../src/config.js";
import { DryRunSink, toMarket, type MarketSource } from "../src/delphi.js";
import { runOnce, type Anchorer } from "../src/runner.js";
import { AgentState } from "../src/state.js";

const NOW = new Date("2026-11-20T12:00:00Z");

function candles(): string {
  const rows: number[][] = [];
  let p = 64000;
  for (let i = 0; i < 90; i++) {
    p *= 1 + 0.015 * Math.sin(i * 1.7);
    rows.push([Date.parse("2026-08-23T00:00:00Z") / 1000 + i * 86400, p, p, p, p, 1]);
  }
  return JSON.stringify(rows.reverse());
}

const http = fakeHttp({ "https://api.exchange.coinbase.com/products/BTC-USD/candles": candles() });
const btc = (id: string, q = "Will Bitcoin close above $150,000 on December 31, 2026?"): Market => ({ id, question: q, closeTime: "2026-12-31T23:59:59Z" });

function setup(markets: Market[], env: Record<string, string> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "os-agent-"));
  const cfg = readConfig({ OS_DATA_DIR: dataDir, OS_ANCHOR_EVERY: "1", ...env });
  const log = new AuditLog(new MemoryStore(), cfg.agentId);
  const state = new AgentState(dataDir);
  const sink = new DryRunSink();
  const source: MarketSource = { listMarkets: async () => markets };
  const anchored: number[] = [];
  const anchorer: Anchorer = { network: "concordium:test", anchor: async (b) => (anchored.push(b.count), { txHash: `tx${anchored.length}`, explorerUrl: "x" }) };
  const run = () => runOnce({ cfg, log, state, markets: source, sink, http, anchorer, now: () => NOW });
  return { cfg, log, state, sink, run, anchored, dataDir };
}

describe("runOnce", () => {
  it("submits decisive evidence with a verification file, logs everything and anchors", async () => {
    const t = setup([btc("m1"), { id: "m2", question: "Who will win the cup?", closeTime: "2026-12-31T00:00:00Z" }]);
    const s = await t.run();
    expect(s).toMatchObject({ markets: 2, planned: 1, evidence: 1, submitted: 1 });
    expect(t.sink.sent[0]!.files[0]!.name).toMatch(/^oracle-scout-.*\.json$/);
    expect(t.sink.sent[0]!.note).toMatch(/points to NO/);
    const entries = await t.log.entries();
    expect(verifyChain(entries).ok).toBe(true);
    expect(entries.map((e) => e.kind)).toEqual(
      expect.arrayContaining(["run.start", "market.triage", "source.fetch", "analysis", "evidence.created", "evidence.submitted", "run.end", "anchor"]),
    );
    expect(t.anchored).toHaveLength(1);
  });

  it("does not resubmit the same data point on the next run", async () => {
    const t = setup([btc("m1")]);
    await t.run();
    const s2 = await t.run();
    expect(s2).toMatchObject({ evidence: 1, submitted: 0, blocked: 1 });
    const blocks = (await t.log.entries()).filter((e) => e.kind === "guardrail.block");
    expect(blocks.at(-1)!.payload).toMatchObject({ rule: "novelty" });
  });

  it("honours the kill switch", async () => {
    const t = setup([btc("m1")]);
    writeFileSync(join(t.dataDir, "KILL"), "testing");
    const s = await t.run();
    expect(s.submitted).toBe(0);
    expect(t.sink.sent).toHaveLength(0);
  });

  it("caps submissions per run", async () => {
    const t = setup([btc("a"), btc("b"), btc("c")], { OS_MAX_PER_RUN: "2" });
    const s = await t.run();
    expect(s.submitted).toBe(2);
    expect(s.blocked).toBe(1);
  });

  it("never argues the other side of a market it already took", async () => {
    const t = setup([btc("m1")]);
    await t.state.addSubmission({ evidenceId: "old", marketId: "m1", stance: "YES", fingerprint: "f", note: "different", submittedAt: NOW.toISOString(), dryRun: true });
    const s = await t.run();
    expect(s.submitted).toBe(0);
    const block = (await t.log.entries()).find((e) => e.kind === "guardrail.block")!;
    expect(String((block.payload as { reason: string }).reason)).toMatch(/stance lock|argued YES/);
  });
});

describe("toMarket", () => {
  it("maps the Delphi SDK market shape", () => {
    const m = toMarket({
      id: "0xabc",
      appMarketId: "uuid",
      marketUrl: "https://agent-competition.gensyn.ai/m/uuid",
      status: "open",
      category: "crypto",
      metadata: { question: "Will BTC close above $100k?", outcomes: ["No", "Yes"], resolutionCriteria: "Coinbase close" },
      resolvesAt: "2026-12-31T00:00:00Z",
      impliedProbabilities: [0.7, 0.3],
    });
    expect(m).toMatchObject({ id: "0xabc", question: "Will BTC close above $100k?", closeTime: "2026-12-31T00:00:00Z", yesPrice: 0.3, category: "crypto" });
    expect(m.description).toMatch(/Resolution: Coinbase close/);
  });
});

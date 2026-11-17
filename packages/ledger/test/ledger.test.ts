import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AuditLog,
  MemoryStore,
  buildArticle12Export,
  canonicalJson,
  inclusionProof,
  merkleRoot,
  proofForEntry,
  toCsv,
  verifyChain,
  verifyInclusion,
  type LogEntry,
} from "../src/index.js";
import { JsonlFileStore } from "../src/node.js";
import { sha256Hex } from "../src/hash.js";

const fixedClock = () => {
  let t = Date.parse("2026-11-20T12:00:00Z");
  return () => new Date((t += 1000));
};

describe("canonicalJson", () => {
  it("is independent of key order and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } })).toBe(
      canonicalJson({ a: { d: [1, { y: 2, z: 1 }] }, b: 1 }),
    );
  });
  it("refuses NaN", () => {
    expect(() => canonicalJson({ x: NaN })).toThrow();
  });
});

describe("merkle", () => {
  const hashes = Array.from({ length: 13 }, (_, i) => sha256Hex(`entry-${i}`));

  it("proves every leaf for every tree size", () => {
    for (let n = 1; n <= hashes.length; n++) {
      const slice = hashes.slice(0, n);
      const root = merkleRoot(slice);
      for (let i = 0; i < n; i++) {
        const p = inclusionProof(slice, i);
        expect(p.root).toBe(root);
        expect(verifyInclusion(p, root)).toBe(true);
      }
    }
  });

  it("rejects a tampered leaf or sibling", () => {
    const p = inclusionProof(hashes, 5);
    expect(verifyInclusion({ ...p, leaf: hashes[6]! }, p.root)).toBe(false);
    const path = p.path.map((s, i) => (i === 0 ? { ...s, hash: hashes[0]! } : s));
    expect(verifyInclusion({ ...p, path }, p.root)).toBe(false);
  });

  it("separates leaves from inner nodes (no second-preimage via 2-leaf root)", () => {
    const two = merkleRoot(hashes.slice(0, 2));
    expect(merkleRoot([two])).not.toBe(two);
  });
});

describe("AuditLog", () => {
  it("chains entries, batches them and verifies", async () => {
    const log = new AuditLog(new MemoryStore(), "oracle-scout", fixedClock());
    await log.append("run.start", { runId: "r1" });
    await log.append("source.fetch", { source: "fred", url: "https://fred.example/CPI", contentHash: "ab" });
    await log.append("evidence.created", { evidenceId: "e1", claim: "CPI rose" });
    const batch = await log.pendingBatch();
    expect(batch).toMatchObject({ batch: 0, fromSeq: 0, toSeq: 2, count: 3 });
    await log.recordAnchor({ ...batch!, network: "concordium:testnet", txHash: "tx1", anchoredAt: "2026-11-20T12:01:00Z" });
    await log.append("run.end", { runId: "r1", summary: { evidence: 1 } });

    const next = await log.pendingBatch();
    expect(next).toMatchObject({ batch: 1, fromSeq: 3, toSeq: 4 });
    expect(verifyChain(await log.entries()).ok).toBe(true);
  });

  it("detects edited payloads, edited hashes and deleted entries", async () => {
    const log = new AuditLog(new MemoryStore(), "a", fixedClock());
    for (let i = 0; i < 4; i++) await log.append("analysis", { i });
    const entries = await log.entries();

    const edited = structuredClone(entries);
    (edited[1]!.payload as { i: number }).i = 99;
    expect(verifyChain(edited).errors.join()).toMatch(/payload was altered/);

    const deleted = entries.filter((e) => e.seq !== 2);
    expect(verifyChain(deleted).ok).toBe(false);

    const rehashed = structuredClone(entries);
    rehashed[3]!.entryHash = "f".repeat(64);
    expect(verifyChain(rehashed).ok).toBe(false);
  });

  it("still verifies when payloads are redacted", async () => {
    const log = new AuditLog(new MemoryStore(), "a", fixedClock());
    await log.append("analysis", { secret: "x" });
    await log.append("analysis", { y: 1 });
    const redacted = (await log.entries()).map(({ payload: _p, ...r }) => r as LogEntry);
    expect(verifyChain(redacted).ok).toBe(true);
  });

  it("serializes concurrent appends", async () => {
    const log = new AuditLog(new MemoryStore(), "a");
    await Promise.all(Array.from({ length: 20 }, (_, i) => log.append("analysis", { i })));
    const entries = await log.entries();
    expect(entries.map((e) => e.seq)).toEqual([...Array(20).keys()]);
    expect(verifyChain(entries).ok).toBe(true);
  });

  it("persists to JSONL and reloads", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "os-ledger-")), "log.jsonl");
    const a = new AuditLog(new JsonlFileStore(path), "a", fixedClock());
    await a.append("run.start", { runId: "r" });
    await a.append("run.end", { runId: "r" });
    const b = new AuditLog(new JsonlFileStore(path), "a", fixedClock());
    await b.append("analysis", { x: 1 });
    const entries = await b.entries();
    expect(entries).toHaveLength(3);
    expect(verifyChain(entries).ok).toBe(true);
  });
});

describe("Article 12 export", () => {
  it("summarises runs, inputs, outputs, risks, oversight and anchors", async () => {
    const log = new AuditLog(new MemoryStore(), "oracle-scout", fixedClock());
    await log.append("run.start", { runId: "r1" });
    await log.append("source.fetch", { source: "fred", url: "u", contentHash: "c" });
    await log.append("guardrail.block", { reason: "per-market cap" });
    await log.append("oversight", { action: "kill-switch.off", by: "owner" });
    await log.append("evidence.submitted", { evidenceId: "e1" });
    const b = (await log.pendingBatch())!;
    await log.recordAnchor({ ...b, network: "concordium:testnet", txHash: "t", anchoredAt: "x" });
    await log.append("run.end", { runId: "r1", summary: { submitted: 1 } });

    const entries = await log.entries();
    const x = buildArticle12Export(entries, {
      system: { name: "Oracle Scout", version: "0.1.0", actor: "oracle-scout", purpose: "test" },
      owner: { lawfulRoute: "via identity provider", verifiedByConcordium: true },
      now: new Date("2026-11-21T00:00:00Z"),
    });
    expect(x.integrity.chainValid).toBe(true);
    expect(x.integrity.anchors[0]!.rootMatchesLog).toBe(true);
    expect(x.integrity.unanchoredEntries).toBe(2);
    expect(x.periodsOfUse[0]).toMatchObject({ runId: "r1", summary: { submitted: 1 } });
    expect(x.inputs).toHaveLength(1);
    expect(x.riskEvents).toHaveLength(1);
    expect(x.humanOversight).toHaveLength(1);
    expect(x.exportHash).toMatch(/^[0-9a-f]{64}$/);

    const proof = proofForEntry(entries, 2)!;
    expect(verifyInclusion(proof.proof, proof.anchor.root)).toBe(true);
    expect(proofForEntry(entries, 6)).toBeNull();
    expect(toCsv(entries).split("\n")[0]).toContain("entryHash");
  });
});

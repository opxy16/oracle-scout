#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHttp, planMarket, type ResolverPlan } from "@oracle-scout/evidence";
import { AuditLog, buildArticle12Export, toCsv, verifyChain } from "@oracle-scout/ledger";
import { JsonlFileStore } from "@oracle-scout/ledger/node";
import { loadEnv, readConfig } from "./config.js";
import { DelphiHttp, DryRunSink, FileMarkets, delphiConfigFromEnv, type MarketSource } from "./delphi.js";
import { killSwitch } from "./guardrails.js";
import { anchorPending, refreshReceipts, runOnce, type Anchorer } from "./runner.js";
import { AgentState } from "./state.js";
import { publish } from "./publish.js";
import { randomBytes } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

loadEnv();
const cfg = readConfig();
const [cmd = "help", ...args] = process.argv.slice(2);
const flag = (f: string) => args.includes(f);

const log = new AuditLog(new JsonlFileStore(join(cfg.dataDir, "audit-log.jsonl")), cfg.agentId);
const state = new AgentState(cfg.dataDir);
const http = createHttp();
const delphi = new DelphiHttp(delphiConfigFromEnv(process.env, { id: cfg.agentId, harness: cfg.harness, model: cfg.model }));

function marketSource(): MarketSource {
  const file = process.env.DELPHI_MARKETS_FILE;
  return file ? new FileMarkets(resolve(file)) : delphi;
}

async function overrides(): Promise<Record<string, ResolverPlan>> {
  try {
    return JSON.parse(await readFile(join(cfg.dataDir, "plans.json"), "utf8")) as Record<string, ResolverPlan>;
  } catch {
    return {};
  }
}

async function anchorer(): Promise<Anchorer | undefined> {
  if (flag("--no-anchor")) return undefined;
  try {
    const { concordiumAnchorerFromEnv } = await import("@oracle-scout/concordium");
    return await concordiumAnchorerFromEnv(process.env);
  } catch (err) {
    console.warn(`(anchoring disabled: ${(err as Error).message})`);
    return undefined;
  }
}

const commands: Record<string, () => Promise<void>> = {
  async run() {
    if (flag("--live")) cfg.dryRun = false;
    console.log(`Oracle Scout — ${cfg.dryRun ? "DRY RUN (nothing leaves this machine)" : "LIVE"} — data in ${cfg.dataDir}`);
    const s = await runOnce({
      cfg,
      log,
      state,
      markets: marketSource(),
      sink: cfg.dryRun ? new DryRunSink() : delphi,
      http,
      anchorer: await anchorer(),
      overrides: await overrides(),
      say: console.log,
    });
    console.log(JSON.stringify(s, null, 2));
  },

  async markets() {
    const ms = await marketSource().listMarkets();
    const ov = await overrides();
    for (const m of ms) {
      const r = planMarket(m, ov);
      console.log(`${r.plan ? "✓" : "·"} ${(r.confidence * 100).toFixed(0).padStart(3)}%  ${m.question.slice(0, 90)}\n        ${r.reason}  [${m.id}]`);
    }
  },

  async receipts() {
    console.log(`${await refreshReceipts({ state, sink: delphi, log })} new receipts`);
  },

  async anchor() {
    const a = await anchorer();
    if (!a) throw new Error("No anchorer configured (see .env.example: CONCORDIUM_*)");
    const tx = await anchorPending(log, a, cfg.agentId);
    console.log(tx ? `Anchored: ${tx}` : "Nothing to anchor.");
  },

  async verify() {
    const entries = await log.entries();
    const c = verifyChain(entries);
    console.log(`${c.checked} entries, chain ${c.ok ? "VALID" : "BROKEN"}`);
    for (const e of c.errors) console.log(`  ${e}`);
    if (!c.ok) process.exitCode = 1;
  },

  async export() {
    const entries = await log.entries();
    const out = resolve(args.find((a) => !a.startsWith("--")) ?? join(cfg.dataDir, "exports"));
    await mkdir(out, { recursive: true });
    const x = buildArticle12Export(entries, {
      system: { name: cfg.agentName, version: "0.1.0", actor: cfg.agentId, purpose: "Mines dated, sourced primary-data evidence for forecasting markets" },
      owner: {
        registryAgentId: process.env.OS_REGISTRY_AGENT_ID,
        verifiedByConcordium: process.env.OS_VERIFIED_BADGE === "1",
        lawfulRoute: "Agent Registry entry -> Verified by Concordium badge -> Concordium identity provider, which can disclose the owner to a competent authority under its legal process. No personal data is held in this log.",
      },
      redactPayloads: flag("--redact"),
    });
    const stamp = x.generatedAt.replace(/[:.]/g, "-");
    await writeFile(join(out, `article12-${stamp}.json`), JSON.stringify(x, null, 2));
    await writeFile(join(out, `audit-log-${stamp}.csv`), toCsv(entries));
    console.log(`Wrote ${out}/article12-${stamp}.json and .csv (export hash ${x.exportHash})`);
  },

  async kill() {
    const p = join(cfg.dataDir, "KILL");
    await mkdir(cfg.dataDir, { recursive: true });
    if (args[0] === "off") {
      await rm(p, { force: true });
      await log.append("oversight", { action: "kill-switch.off", by: "owner (CLI)" });
      console.log("Kill switch released.");
    } else {
      const reason = args.slice(args[0] === "on" ? 1 : 0).join(" ") || "engaged by owner";
      await writeFile(p, reason);
      await log.append("oversight", { action: "kill-switch.on", by: "owner (CLI)", reason });
      console.log(`Kill switch ENGAGED: ${reason}`);
    }
  },

  async "owner-proof"() {
    const path = resolve(process.env.OS_PUBLIC_LEDGER_DIR ?? "ledger", "owner-proof.json");
    const rec = JSON.parse(await readFile(path, "utf8")) as {
      ctx: { tokenId: number; owner: string; minAge: number; issuedAt: string };
      presentation: string;
      result: { ok: boolean; challenge: string; account?: string; credId?: string; statement?: unknown; verifiedAt: string };
    };
    if (!rec.result.ok) throw new Error("The saved owner proof did not verify; not logging it.");
    const { createHash } = await import("node:crypto");
    await log.append("oversight", {
      action: "owner.proof",
      reason: `Concordium ID zero-knowledge proof: owner of agent #${rec.ctx.tokenId} is aged ${rec.ctx.minAge}+`,
      by: "owner (Concordium Wallet for Web)",
      tokenId: rec.ctx.tokenId,
      account: rec.result.account,
      challenge: rec.result.challenge,
      statement: rec.result.statement,
      presentationHash: createHash("sha256").update(rec.presentation).digest("hex"),
      provedAt: rec.ctx.issuedAt,
      verifiedAt: rec.result.verifiedAt,
    });
    console.log(`Logged owner proof for agent #${rec.ctx.tokenId} (account ${rec.result.account}).`);
  },

  async keygen() {
    if (process.env.OS_PACK_KEY) {
      console.log("OS_PACK_KEY already set in .env; leaving it unchanged.");
      return;
    }
    await appendFile(resolve(".env"), `\n# Evidence-pack encryption key (copy to the web app's env as OS_PACK_KEY). Never commit.\nOS_PACK_KEY=${randomBytes(32).toString("base64")}\n`);
    console.log("Wrote a new OS_PACK_KEY to .env (git-ignored). Add the same value to the web deployment's environment.");
  },

  async publish() {
    const out = resolve(process.env.OS_PUBLIC_LEDGER_DIR ?? "ledger");
    const r = await publish(cfg, state, out);
    console.log(`Published ${r.entries} log entries and ${r.packs} sealed packs to ${out}`);
    if (flag("--push")) {
      const git = (...a: string[]) => execFileSync("git", a, { stdio: "inherit" });
      git("add", out);
      try {
        git("commit", "-m", `Publish ledger: ${r.entries} entries, ${r.packs} packs`);
        git("push");
      } catch {
        console.log("(nothing new to commit, or push failed; see git output above)");
      }
    }
  },

  async status() {
    const subs = await state.submissions();
    const entries = await log.entries();
    const anchors = await log.anchors();
    const pending = await log.pendingBatch();
    console.log({
      killSwitch: killSwitch(cfg.dataDir),
      dryRun: cfg.dryRun,
      submissions: subs.length,
      liveSubmissions: subs.filter((s) => !s.dryRun).length,
      markets: new Set(subs.filter((s) => !s.dryRun).map((s) => s.marketId)).size,
      logEntries: entries.length,
      anchors: anchors.length,
      lastAnchor: anchors[anchors.length - 1]?.explorerUrl ?? anchors[anchors.length - 1]?.txHash,
      unanchored: pending?.count ?? 0,
    });
  },

  async help() {
    console.log(`Usage: npm run agent -- <command>
  run [--live] [--no-anchor]   triage markets, mine evidence, submit (dry run unless --live / OS_DRY_RUN=0)
  markets                      list open markets and whether primary data can settle them
  receipts                     fetch judge receipts for live submissions
  anchor                       anchor unanchored audit-log entries on Concordium
  verify                       recompute the audit log hash chain
  export [dir] [--redact]      EU AI Act Art. 12-style export (JSON + CSV)
  kill on [reason] | kill off  engage / release the kill switch
  keygen                       create the evidence-pack encryption key in .env
  publish [--push]             write the public ledger (log + sealed packs) to ./ledger, optionally git push
  status                       counts, anchors, kill switch`);
  },
};

(commands[cmd] ?? commands.help!)().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

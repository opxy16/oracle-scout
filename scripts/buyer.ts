/**
 * Demo buyer agent: "trust, then pay, then verify".
 *   npm run buyer -- https://<host>/api/packs/<marketId>
 *
 * 1. Fetch the seller's Agent Card and read its Verified by Concordium badge.
 * 2. Check the badge with the Concordium Agent Registry. No valid badge, no payment.
 * 3. Pay over x402 (Concordium sponsored CCD transfer: the seller's facilitator pays the fee),
 *    only if payTo is the seller's registered wallet and the price is under our cap.
 * 4. Verify what we bought: item hashes match the seller's audit log, and the log entries
 *    are inside a Merkle root anchored on Concordium.
 * Buyer key: CONCORDIUM_BUYER_WALLET (wallet export path). Nothing secret is printed.
 */
import { existsSync } from "node:fs";
import { hashObject, verifyInclusion, type InclusionProof } from "@oracle-scout/ledger";
import { BADGE_EXTENSION_URI, checkBadgeRest, loadWalletExport, payAndFetch } from "@oracle-scout/concordium";

for (const f of [".env", ".env.local"]) if (existsSync(f)) (process as unknown as { loadEnvFile(p: string): void }).loadEnvFile(f);

const url = process.argv[2];
if (!url) {
  console.log("usage: npm run buyer -- <pack url>");
  process.exit(1);
}
const MAX = BigInt(process.env.BUYER_MAX_MICROCCD ?? "5000000");

const step = (n: number, s: string) => console.log(`\n[${n}] ${s}`);

async function main() {
  const origin = new URL(url!).origin;
  step(1, `Reading the seller's Agent Card at ${origin}/.well-known/agent-card.json`);
  const card = (await (await fetch(`${origin}/.well-known/agent-card.json`)).json()) as {
    name: string;
    capabilities?: { extensions?: { uri: string; params?: { tokenAddress?: string; agentWallet?: string; owner?: { account?: string } } }[] };
  };
  const ext = card.capabilities?.extensions?.find((e) => e.uri === BADGE_EXTENSION_URI);
  const badge = ext?.params?.tokenAddress?.split("/cis-2:")[1] ?? ext?.params?.tokenAddress;
  if (!badge) throw new Error("Seller has no Verified by Concordium badge in its card. Refusing to pay.");
  const wallet = (ext?.params?.agentWallet ?? ext?.params?.owner?.account ?? "").split(":").pop()!;
  console.log(`    ${card.name}: badge ${badge}, registered wallet ${wallet.slice(0, 10)}…`);

  step(2, "Checking the badge with the Concordium Agent Registry");
  const check = await checkBadgeRest(badge, "testnet");
  console.log(`    badge_valid=${check.badge_valid} extension_conformant=${check.extension_conformant} issues=${JSON.stringify(check.issues ?? [])}`);
  if (!check.badge_valid) throw new Error("Badge is not valid. Refusing to pay.");

  step(3, `Requesting ${url} (paying over x402 if asked, cap ${Number(MAX) / 1e6} CCD)`);
  const buyerPath = process.env.CONCORDIUM_BUYER_WALLET;
  if (!buyerPath) throw new Error("Set CONCORDIUM_BUYER_WALLET in .env");
  const buyer = loadWalletExport(buyerPath);
  const { response, settlement, requirements } = await payAndFetch(url!, buyer, {
    maxMicroCcd: MAX,
    beforePay: async (req) => {
      if (wallet && req.payTo !== wallet) throw new Error(`payTo ${req.payTo} is not the seller's registered wallet ${wallet}`);
      console.log(`    paying ${Number(req.amount) / 1e6} CCD to ${req.payTo.slice(0, 10)}…, fee sponsored by ${String((req.extra as { feePayer?: string }).feePayer).slice(0, 10)}…`);
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  if (settlement) console.log(`    settled: https://ccdexplorer.io/testnet/transaction/${settlement.transaction}`);
  else if (requirements) console.log("    (no settlement header returned)");

  step(4, "Verifying the pack against the seller's anchored audit log");
  const pack = (await response.json()) as {
    question: string;
    items: (Record<string, unknown> & { id: string; contentHash?: string; headline?: string; stance?: string })[];
    integrity: { itemHash: string; loggedHash?: string; matchesLog: boolean; anchor?: { root: string; txHash: string }; proof?: InclusionProof }[];
  };
  console.log(`    ${pack.question}`);
  pack.items.forEach((it, i) => {
    const { contentHash: _c, ...rest } = it;
    const mine = hashObject(rest);
    const integ = pack.integrity[i]!;
    const inLog = integ.loggedHash === mine;
    const anchored = integ.proof && integ.anchor ? verifyInclusion(integ.proof, integ.anchor.root) : false;
    console.log(`    • ${it.stance} — ${it.headline}`);
    console.log(`      hash matches audit log: ${inLog ? "yes" : "NO"} · Merkle proof to on-chain root: ${anchored ? `yes (tx ${integ.anchor!.txHash.slice(0, 12)}…)` : "not anchored yet"}`);
  });
}

main().catch((e) => {
  console.error(`\n✗ ${(e as Error).message}`);
  process.exitCode = 1;
});

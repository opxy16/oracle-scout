/**
 * Save a Concordium testnet account key into the git-ignored keys/ folder, safely.
 *
 *   npm run keys:import -- agent     (then sponsor, then buyer)
 *
 * Asks for the account address and its private (sign) key with hidden input, checks on
 * chain that the key really belongs to that account (credential 0, key 0), and writes
 * keys/<role>.export in the Concordium Wallet export format. Only addresses are printed.
 */
import { createPrivateKey, createPublicKey } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { AccountAddress } from "@concordium/web-sdk";
import { grpcClient, TESTNET } from "@oracle-scout/concordium";

const ROLES = ["agent", "sponsor", "buyer"];
const role = process.argv[2];
if (!role || !ROLES.includes(role)) {
  console.log(`usage: npm run keys:import -- <${ROLES.join("|")}>`);
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
let muted = false;
const out = rl as unknown as { _writeToOutput: (s: string) => void };
const write = out._writeToOutput.bind(rl);
out._writeToOutput = (s: string) => {
  if (!muted) write(s);
  else if (s.includes("\n")) process.stdout.write("\n");
};

// Piped (non-terminal) input: read all lines up front so none are lost between prompts.
const piped: Promise<string[]> | null = process.stdin.isTTY
  ? null
  : new Promise((resolve) => {
      const lines: string[] = [];
      rl.on("line", (l) => lines.push(l));
      rl.on("close", () => resolve(lines));
    });
let pipedIndex = 0;

function ask(question: string, hidden: boolean): Promise<string> {
  if (piped) return piped.then((lines) => (process.stdout.write(`${question}\n`), (lines[pipedIndex++] ?? "").trim()));
  return new Promise((resolve) => {
    muted = false;
    rl.question(question, (answer) => {
      muted = false;
      resolve(answer.trim());
    });
    muted = hidden;
  });
}

/** Ed25519 public key (hex) from a 32-byte private seed (hex), via Node's crypto. */
function publicKeyHex(signKeyHex: string): string {
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(signKeyHex, "hex")]);
  const pub = createPublicKey(createPrivateKey({ key: der, format: "der", type: "pkcs8" }));
  return Buffer.from(pub.export({ format: "der", type: "spki" })).subarray(-32).toString("hex");
}

async function main() {
  const address = await ask(`${role} account address: `, false);
  AccountAddress.fromBase58(address); // throws on a malformed address
  const signKey = (await ask(`${role} private key (hidden): `, true)).replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(signKey)) throw new Error("A private key is 64 hex characters.");

  const info = await grpcClient(TESTNET).getAccountInfo(AccountAddress.fromBase58(address));
  const cred = info.accountCredentials[0] as unknown as { value: { contents: { credentialPublicKeys: { keys: Record<string, { verifyKey: string }> } } } };
  const onChain = cred.value.contents.credentialPublicKeys.keys["0"]?.verifyKey;
  const verifyKey = publicKeyHex(signKey);
  if (!onChain || onChain.toLowerCase() !== verifyKey) {
    throw new Error(`That key does not belong to ${address}. Nothing was saved. Check you copied the key of the right account.`);
  }

  const exportFile = {
    type: "concordium-browser-wallet-account",
    v: 0,
    environment: "testnet",
    value: {
      address,
      accountKeys: { keys: { "0": { keys: { "0": { signKey, verifyKey } } } }, threshold: 1 },
      credentials: { "0": (info.accountCredentials[0] as unknown as { value: { contents: { credId?: string; regId?: string } } }).value.contents.credId ?? "" },
    },
  };
  mkdirSync("keys", { recursive: true });
  writeFileSync(`keys/${role}.export`, JSON.stringify(exportFile, null, 2), { mode: 0o600 });
  rl.close();
  console.log(`✓ ${role}: key matches ${address} on testnet. Saved to keys/${role}.export (git-ignored).`);
}

main().catch((e) => {
  rl.close();
  console.error(`✗ ${(e as Error).message}`);
  process.exitCode = 1;
});

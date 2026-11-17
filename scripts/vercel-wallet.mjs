// Turn a wallet export into one base64 line for a host's env var (keys/<role>.vercel-b64.txt, git-ignored).
// Usage: npm run keys:vercel -- sponsor      Prints the address only.
import { readFileSync, writeFileSync } from "node:fs";
const role = process.argv[2] ?? "sponsor";
const json = JSON.stringify(JSON.parse(readFileSync(`keys/${role}.export`, "utf8")));
writeFileSync(`keys/${role}.vercel-b64.txt`, Buffer.from(json).toString("base64"));
console.log(`Wrote keys/${role}.vercel-b64.txt for ${JSON.parse(json).value.address}. Paste its contents into the host's CONCORDIUM_${role.toUpperCase()}_WALLET_B64 secret.`);

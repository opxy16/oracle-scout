import "server-only";
import { createFacilitator, loadWalletExport, paymentRequirements, walletFromJson, type Account } from "@oracle-scout/concordium";

let facilitator: ReturnType<typeof createFacilitator> | null = null;
let sponsor: Account | null = null;

/** Seller config from env. The sponsor key comes from a wallet export (file path locally, JSON secret on a host). */
export function sellerConfig() {
  const payTo = process.env.OS_PAYTO ?? process.env.OS_OWNER_ACCOUNT;
  if (!payTo) throw new Error("OS_PAYTO (seller account address) not configured");
  if (!sponsor) {
    const b64 = process.env.CONCORDIUM_SPONSOR_WALLET_B64?.trim();
    const json = b64 ? Buffer.from(b64, "base64").toString("utf8") : process.env.CONCORDIUM_SPONSOR_WALLET_JSON;
    const path = process.env.CONCORDIUM_SPONSOR_WALLET;
    if (json) sponsor = walletFromJson(json);
    else if (path) sponsor = loadWalletExport(path);
    else throw new Error("x402 facilitator sponsor wallet not configured");
  }
  facilitator ??= createFacilitator(sponsor);
  const amount = BigInt(process.env.OS_PACK_PRICE_MICROCCD ?? "2000000");
  return { facilitator, requirements: paymentRequirements({ payTo, feePayer: sponsor.address, amountMicroCcd: amount }) };
}

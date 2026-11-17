import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader, decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { ExactConcordiumScheme as ClientScheme } from "@x402/concordium/exact/client";
import { ExactConcordiumScheme as FacilitatorScheme } from "@x402/concordium/exact/facilitator";
import { toConcordiumFacilitatorSigner } from "@x402/concordium";
import { AccountAddress } from "@concordium/web-sdk";
import type { Account } from "./chain.js";
import { TESTNET, type CcdNetwork } from "./network.js";

/**
 * x402 v2 over HTTP for Concordium (exact scheme, V1 sponsored transactions).
 *   402 + PAYMENT-REQUIRED  ->  retry with PAYMENT-SIGNATURE  ->  200 + PAYMENT-RESPONSE
 * The buyer signs a CCD transfer naming our facilitator as fee sponsor, so the buyer needs no CCD for gas.
 * No public Concordium facilitator exists yet, so we run one in-process with its own funded account.
 */

export interface PaywallConfig {
  network?: CcdNetwork;
  payTo: string;
  /** Price in microCCD (1 CCD = 1_000_000). */
  amountMicroCcd: bigint;
  feePayer: string;
  maxTimeoutSeconds?: number;
}

export function paymentRequirements(cfg: PaywallConfig): PaymentRequirements {
  return {
    scheme: "exact",
    network: (cfg.network ?? TESTNET).caip2 as PaymentRequirements["network"],
    amount: cfg.amountMicroCcd.toString(),
    asset: "CCD",
    payTo: cfg.payTo,
    maxTimeoutSeconds: cfg.maxTimeoutSeconds ?? 120,
    extra: { feePayer: cfg.feePayer },
  } as PaymentRequirements;
}

export function paymentRequiredHeader(req: PaymentRequirements, resource: { url: string; description: string; mimeType: string }, error = "Payment required"): string {
  return encodePaymentRequiredHeader({ x402Version: 2, error, resource, accepts: [req] } as never);
}

/** Facilitator that sponsors (pays fees for) buyer transfers. The sponsor is a wallet-export Account (opaque signer). */
export function createFacilitator(sponsor: Account, network: CcdNetwork = TESTNET): FacilitatorScheme {
  const signer = toConcordiumFacilitatorSigner(sponsor.address, sponsor.signer, {
    host: network.grpcHost,
    port: network.grpcPort,
    useTls: true,
    network: network.caip2 as never,
  });
  return new FacilitatorScheme({ signer, requireFinalization: true, finalizationTimeoutMs: 60_000 });
}

export type PaidResult =
  | { status: 402; headers: Record<string, string>; body: unknown }
  | { status: 200; headers: Record<string, string>; settlement: SettleResponse; payer?: string };

/**
 * Framework-agnostic paywall step. Call with the request's PAYMENT-SIGNATURE header (or null).
 * Returns either a 402 to send back, or a settled payment (then serve the resource with the headers given).
 */
export async function handlePayment(
  signatureHeader: string | null,
  req: PaymentRequirements,
  resource: { url: string; description: string; mimeType: string },
  facilitator: Pick<FacilitatorScheme, "verify" | "settle">,
): Promise<PaidResult> {
  const required = (error: string) => ({
    status: 402 as const,
    headers: { "PAYMENT-REQUIRED": paymentRequiredHeader(req, resource, error), "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE" },
    body: { x402Version: 2, error, resource, accepts: [req] },
  });
  if (!signatureHeader) return required("Payment required");
  let payload: PaymentPayload;
  try {
    payload = decodePaymentSignatureHeader(signatureHeader);
  } catch {
    return required("Malformed PAYMENT-SIGNATURE header");
  }
  const v = await facilitator.verify(payload, req);
  if (!v.isValid) return required(`Payment invalid: ${v.invalidReason ?? "unknown"}`);
  const s = await facilitator.settle(payload, req);
  if (!s.success) return required(`Settlement failed: ${s.errorReason ?? "unknown"}`);
  return {
    status: 200,
    headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader(s), "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE" },
    settlement: s,
    payer: s.payer,
  };
}

/** Buyer side: fetch a resource, paying via x402 if asked, after a caller-supplied check (e.g. the seller's badge). */
export async function payAndFetch(
  url: string,
  buyer: Account,
  opts: { maxMicroCcd: bigint; beforePay?: (req: PaymentRequirements) => Promise<void>; network?: CcdNetwork; f?: typeof fetch } ,
): Promise<{ response: Response; settlement?: SettleResponse; requirements?: PaymentRequirements }> {
  const f = opts.f ?? fetch;
  const first = await f(url);
  if (first.status !== 402) return { response: first };
  const header = first.headers.get("PAYMENT-REQUIRED");
  if (!header) throw new Error("402 without PAYMENT-REQUIRED header");
  const required = decodePaymentRequiredHeader(header) as { accepts: PaymentRequirements[]; resource: unknown };
  const n = opts.network ?? TESTNET;
  const req = required.accepts.find((a) => a.network === n.caip2 && a.scheme === "exact" && a.asset === "CCD");
  if (!req) throw new Error("No acceptable Concordium CCD payment option offered");
  if (BigInt(req.amount) > opts.maxMicroCcd) throw new Error(`Price ${req.amount} microCCD exceeds cap ${opts.maxMicroCcd}`);
  await opts.beforePay?.(req);
  const scheme = new ClientScheme({ accountAddress: AccountAddress.fromBase58(buyer.address), signer: buyer.signer } as never, { grpcUrl: `${n.grpcHost}:${n.grpcPort}`, useTls: true });
  const partial = await scheme.createPaymentPayload(2, req);
  const payload = { ...partial, resource: required.resource, accepted: req } as PaymentPayload;
  const response = await f(url, { headers: { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload) } });
  const resHeader = response.headers.get("PAYMENT-RESPONSE");
  return { response, settlement: resHeader ? decodePaymentResponseHeader(resHeader) : undefined, requirements: req };
}

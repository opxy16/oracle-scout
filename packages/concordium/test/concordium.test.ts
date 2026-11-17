import { describe, expect, it } from "vitest";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { anchorMemo, cborText, decodeCborText, handlePayment, paymentRequirements, RegistryMcp, TESTNET } from "../src/index.js";

describe("anchor memo", () => {
  it("round-trips CBOR text and fits RegisterData's 256-byte limit", () => {
    for (const s of ["", "a", "x".repeat(23), "x".repeat(24), "x".repeat(200), "x".repeat(300)]) {
      expect(decodeCborText(cborText(s))).toBe(s);
    }
    const memo = anchorMemo("oracle-scout-with-a-rather-long-agent-identifier-xyz", { batch: 12345, fromSeq: 1000000, toSeq: 1999999, root: "ab".repeat(32) });
    expect(memo.length).toBeLessThanOrEqual(256);
    expect(decodeCborText(memo)).toMatch(/^oracle-scout\/1 .* b=12345 seq=1000000-1999999 root=(ab){32}$/);
  });
});

describe("x402 paywall", () => {
  const req = paymentRequirements({ payTo: "SELLER", feePayer: "SPONSOR", amountMicroCcd: 2_000_000n });
  const resource = { url: "https://x/api/packs/m1", description: "Evidence pack", mimeType: "application/json" };

  it("builds Concordium testnet CCD requirements", () => {
    expect(req).toMatchObject({ scheme: "exact", network: TESTNET.caip2, asset: "CCD", amount: "2000000", payTo: "SELLER", extra: { feePayer: "SPONSOR" } });
  });

  it("answers 402 with a decodable PAYMENT-REQUIRED header when unpaid", async () => {
    const r = await handlePayment(null, req, resource, { verify: async () => ({ isValid: true }), settle: async () => ({ success: true }) } as never);
    expect(r.status).toBe(402);
    const decoded = decodePaymentRequiredHeader(r.headers["PAYMENT-REQUIRED"]!) as { accepts: unknown[]; x402Version: number };
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepts[0]).toMatchObject({ payTo: "SELLER" });
  });

  it("verifies, settles and returns PAYMENT-RESPONSE when paid", async () => {
    const calls: string[] = [];
    const fac = {
      verify: async () => (calls.push("verify"), { isValid: true, payer: "BUYER" }),
      settle: async () => (calls.push("settle"), { success: true, transaction: "abc", network: TESTNET.caip2, payer: "BUYER" }),
    };
    const sig = encodePaymentSignatureHeader({ x402Version: 2, resource, accepted: req, payload: { signedTransaction: {} } } as never);
    const r = await handlePayment(sig, req, resource, fac as never);
    expect(calls).toEqual(["verify", "settle"]);
    expect(r.status).toBe(200);
    if (r.status === 200) expect(decodePaymentResponseHeader(r.headers["PAYMENT-RESPONSE"]!)).toMatchObject({ transaction: "abc" });
  });

  it("refuses invalid payments without settling", async () => {
    let settled = false;
    const fac = { verify: async () => ({ isValid: false, invalidReason: "amount_mismatch" }), settle: async () => ((settled = true), { success: true }) };
    const sig = encodePaymentSignatureHeader({ x402Version: 2, resource, accepted: req, payload: {} } as never);
    const r = await handlePayment(sig, req, resource, fac as never);
    expect(r.status).toBe(402);
    expect(settled).toBe(false);
  });
});

describe("RegistryMcp", () => {
  it("always sends the network and parses text content", async () => {
    let body: { params: { name: string; arguments: Record<string, unknown> } } | undefined;
    const fake = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: '{"badge_valid":true,"issues":[]}' }] } }));
    }) as unknown as typeof fetch;
    const r = await new RegistryMcp("testnet", "https://mcp.test/mcp", fake).checkBadge("JyP9");
    expect(body!.params).toMatchObject({ name: "check_badge", arguments: { id: "JyP9", network: "testnet" } });
    expect(r.badge_valid).toBe(true);
  });

  it("surfaces tool errors", async () => {
    const fake = (async () => new Response(JSON.stringify({ result: { isError: true, content: [{ type: "text", text: "bad token" }] } }))) as unknown as typeof fetch;
    await expect(new RegistryMcp("testnet", "u", fake).checkBadge("x")).rejects.toThrow(/bad token/);
  });
});

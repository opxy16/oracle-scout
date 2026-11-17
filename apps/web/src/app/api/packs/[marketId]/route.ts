import { NextResponse } from "next/server";
import { handlePayment } from "@oracle-scout/concordium";
import { loadLedger } from "@/lib/ledger";
import { openPack } from "@/lib/packs";
import { sellerConfig } from "@/lib/x402";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * x402-paid evidence pack.
 *   no PAYMENT-SIGNATURE  -> 402 + PAYMENT-REQUIRED (Concordium testnet, CCD, sponsored fees)
 *   valid payment         -> facilitator verifies + settles on chain, then 200 + pack + PAYMENT-RESPONSE
 */
export async function GET(req: Request, ctx: { params: Promise<{ marketId: string }> }) {
  const { marketId } = await ctx.params;
  const { packs } = await loadLedger();
  const meta = packs.find((p) => p.marketId === marketId);
  if (!meta) return NextResponse.json({ error: "No evidence pack for this market" }, { status: 404 });

  let cfg;
  try {
    cfg = sellerConfig();
  } catch (e) {
    return NextResponse.json({ error: "Payments are not configured on this deployment", detail: (e as Error).message }, { status: 503 });
  }

  const resource = {
    url: new URL(req.url).toString(),
    description: `Oracle Scout evidence pack: ${meta.question} (${meta.items} item${meta.items > 1 ? "s" : ""}, stance ${meta.stance})`,
    mimeType: "application/json",
  };
  const paid = await handlePayment(req.headers.get("payment-signature"), cfg.requirements, resource, cfg.facilitator);
  if (paid.status === 402) {
    return NextResponse.json(
      {
        ...(paid.body as object),
        preview: { question: meta.question, stance: meta.stance, probability: meta.probability, items: meta.items, itemHashes: meta.itemHashes },
        hint: "Pay with a Concordium sponsored CCD transfer (fees covered), then retry with the PAYMENT-SIGNATURE header. See /api/mcp tool get_pack_offer.",
      },
      { status: 402, headers: paid.headers },
    );
  }
  const pack = await openPack(marketId);
  if (!pack) return NextResponse.json({ error: "Pack missing after payment; contact the operator" }, { status: 500, headers: paid.headers });
  return NextResponse.json({ ...pack, payment: { transaction: paid.settlement.transaction, network: paid.settlement.network, payer: paid.payer } }, { headers: paid.headers });
}

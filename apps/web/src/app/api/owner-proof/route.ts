import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { grpcClient, TESTNET, verifyOwnerProof, type ProofContext } from "@oracle-scout/concordium";
import { agentOwner, proofSecret, verifyStored, type StoredOwnerProof } from "@/lib/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Re-verify the published owner proof against the chain, right now. */
export async function GET() {
  try {
    return NextResponse.json(await verifyStored());
  } catch (e) {
    return NextResponse.json({ present: false, error: (e as Error).message }, { status: 500 });
  }
}

/** Verify a fresh proof from the owner's wallet. On the operator's machine (OS_PROOF_WRITE=1) it is saved for publishing. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { presentation?: string; ctx?: ProofContext; sig?: string } | null;
  if (!body?.presentation || !body.ctx || !body.sig) return NextResponse.json({ error: "presentation, ctx and sig are required" }, { status: 400 });
  try {
    const { owner } = await agentOwner();
    const result = await verifyOwnerProof({
      presentation: body.presentation,
      ctx: body.ctx,
      sig: body.sig,
      secret: proofSecret(),
      expectedOwner: owner,
      client: grpcClient(TESTNET),
      network: TESTNET,
      maxAgeMs: 15 * 60_000,
    });
    let saved = false;
    if (result.ok && process.env.OS_PROOF_WRITE === "1") {
      const rec: StoredOwnerProof = { format: "oracle-scout/owner-proof-record@1", ctx: body.ctx, sig: body.sig, presentation: body.presentation, result };
      const dir = process.env.LEDGER_DIR ?? join(process.cwd(), "..", "..", "ledger");
      await writeFile(join(dir, "owner-proof.json"), JSON.stringify(rec, null, 2));
      saved = true;
    }
    return NextResponse.json({ result, saved }, { status: result.ok ? 200 : 422 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

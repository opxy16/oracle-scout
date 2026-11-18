import { NextResponse } from "next/server";
import { issueChallenge, ownerStatements } from "@oracle-scout/concordium";
import { IDENTITY_PROVIDERS, MIN_AGE, agentOwner, proofSecret } from "@/lib/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A signed, single-purpose challenge binding the proof to this agent's registry token and owner account. */
export async function GET() {
  try {
    const { owner, tokenId, badge } = await agentOwner();
    const c = issueChallenge({ tokenId, badge, owner, minAge: MIN_AGE, secret: proofSecret() });
    return NextResponse.json({ ...c, statements: ownerStatements(MIN_AGE, IDENTITY_PROVIDERS) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}

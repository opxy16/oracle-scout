import { NextResponse } from "next/server";
import { verifyChain } from "@oracle-scout/ledger";
import { loadLedger } from "@/lib/ledger";

export const revalidate = 60;

export async function GET() {
  const { agent, entries, anchors, packs } = await loadLedger();
  const chain = verifyChain(entries);
  return NextResponse.json({ agent, chain: { valid: chain.ok, entries: chain.checked, errors: chain.errors }, anchors, packs });
}

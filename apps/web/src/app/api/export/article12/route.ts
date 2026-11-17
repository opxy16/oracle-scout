import { NextResponse } from "next/server";
import { buildArticle12Export } from "@oracle-scout/ledger";
import { loadLedger } from "@/lib/ledger";

export const revalidate = 60;

/** EU AI Act Article 12-style record-keeping export of the public audit log. */
export async function GET(req: Request) {
  const { entries, agent } = await loadLedger();
  const redact = new URL(req.url).searchParams.get("redact") === "1";
  const x = buildArticle12Export(entries, {
    system: { name: agent?.name ?? "Oracle Scout", version: "0.1.0", actor: agent?.agentId ?? "oracle-scout", purpose: "Mines dated, sourced primary-data evidence for forecasting markets" },
    owner: {
      registryAgentId: agent?.registry?.badge,
      verifiedByConcordium: Boolean(agent?.registry?.badge),
      lawfulRoute:
        "Agent Registry (CIS-8004) entry -> owner account -> Concordium identity provider, which can disclose the account holder to a competent authority under legal process. No personal data is held in this log.",
    },
    redactPayloads: redact,
  });
  return new NextResponse(JSON.stringify(x, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="oracle-scout-article12-${x.generatedAt.slice(0, 10)}.json"` },
  });
}

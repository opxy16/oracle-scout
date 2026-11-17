# Demo video script (≤ 3:00)

Record at 1080p. Use the dashboard on the deployed URL, plus a terminal at the repo root with a large font. Have the CCDExplorer tabs ready.

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:15 | Dashboard hero | "AI agents are starting to act for people. When one is wrong, who is accountable, and can anyone check what it knew? This is Oracle Scout, an evidence agent for prediction markets that's accountable by construction." |
| 0:15–0:40 | Identity card → click "Check the badge yourself" → JSON with `badge_valid: true` | "It's registered in Concordium's Agent Registry and carries the Verified by Concordium badge. A verified human owns it, and no personal data is published. Any agent can check this badge through the registry's public API, without trusting us." |
| 0:40–1:10 | Terminal: `npm run agent -- run --live` (or the dry run) → triage, fetch, abstain and submit lines | "It only takes markets an official data series can settle. Here it pulls BLS CPI and Coinbase prices, computes the odds, and submits only when it's confident and the market disagrees. It never argues both sides, and it never repeats itself." |
| 1:10–1:35 | Dashboard → Audit trail → click Verify on an evidence entry → green result → click the CCDExplorer link → registered data showing the root | "Every step goes into a hash-chained log. Each batch's Merkle root is written to Concordium. I click Verify: my browser recomputes the proof and it matches the root in this testnet transaction." |
| 1:35–2:20 | Terminal: `npm run buyer -- <url>/api/packs/<market>` → steps 1–4 → CCDExplorer settlement tx | "Other agents can buy the full evidence. This buyer agent reads Oracle Scout's card, checks the badge, and only then pays 2 CCD over x402. It's a sponsored transaction, so the buyer pays no fee. It then verifies that each item it bought was in the anchored log before the market resolved." |
| 2:20–2:40 | Click "Art. 12 export" → JSON with periodsOfUse, inputs, riskEvents, humanOversight, anchors | "For regulators there's an EU AI Act Article 12-style export: periods of use, inputs, outputs, risk events, human oversight like the kill switch, and the on-chain integrity checks." |
| 2:40–3:00 | Connect section (MCP and A2A) → README path-to-production | "It speaks MCP and A2A, so any agent framework can plug in. Going to mainnet means switching the contract and pricing in USDR. Oracle Scout: evidence you can trust, from an agent you can hold to account." |

Checklist before recording:

- [ ] Badge check returns `badge_valid: true`
- [ ] At least one anchor after the latest evidence (`npm run agent -- anchor`, then `publish --push`)
- [ ] Buyer account has CCD (an x402 transfer needs a balance for the amount; fees are sponsored)
- [ ] Dashboard deployed with `OS_PACK_KEY`, `OS_PAYTO`, `CONCORDIUM_SPONSOR_WALLET_JSON`

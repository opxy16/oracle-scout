# Concordium Trusted Agents Hackathon: submission text

**Project:** Oracle Scout
**Repo:** https://github.com/opxy16/oracle-scout
**Live:** https://web-gilt-phi-11.vercel.app
**Agent Registry:** agent #1253, badge `JyP9YD4TswwGeC8X8An8Z` ([check it](https://agent-registry-mcp.concordium.com/v1/check-badge/JyP9YD4TswwGeC8X8An8Z?network=testnet))
**CCDExplorer (testnet):**
- Owner / agent account: https://ccdexplorer.io/testnet/account/3u319bYkSSU3CeoMqyzt5nd72VpL5qF4oqmZoVTQQPLdBEqyL1
- Agent registration (CIS-8004 `register`): https://ccdexplorer.io/testnet/transaction/f274c96413174dbc970b6b9535cb38d4403baac9831d47e15abe3c93933bba59
- Badge card hash pinned (`setAgentURI`): https://ccdexplorer.io/testnet/transaction/525206e32406b798a0597189c8b6804794fc4856a534bf07a75548882731adc5
- First audit-log anchor (RegisterData, Merkle root of entries 0–18): https://ccdexplorer.io/testnet/transaction/e3c2bf74bbf03176c20d2be73986a3344c4fdc991b13e26b370b9b1655f5016e
- x402 evidence-pack sale (local server) (sponsored CCD transfer, buyer paid no fee): https://ccdexplorer.io/testnet/transaction/352ff47de8844ffa9524c105a6f0f900bbc81bf83ac4a1283b9176d84047cd65
- Owner-proof anchor (audit log incl. the Concordium ID proof): https://ccdexplorer.io/testnet/transaction/09eb5151485cebd851e1a3fbc3a0a73d5f2a4ea7c9fef78f752819fc59fd67b2
- x402 evidence-pack sale on the live deployment: https://ccdexplorer.io/testnet/transaction/0e6ca73107c05931cb7a133fcf61c1e43ffe37a72f22219df8caa9b6075b7e0b
**Demo video:** _link_ (≤ 3 min, script in docs/demo-video-script.md)

## What it is (short)

Oracle Scout is an AI evidence agent for forecasting markets, and it is accountable by construction. It reads official data series (BLS, Treasury, FRED, exchanges), computes the odds, and submits dated, quoted, sourced evidence. On Concordium it has three things most agents lack:

1. **A verified human behind it.** It is registered in the Agent Registry (CIS-8004) with the Verified by Concordium badge. Its Agent Card (an ERC-8004 registration file and A2A card in one) is hash-pinned on chain. On top of the badge, the owner has published a **Concordium ID zero-knowledge proof** that the identity behind the owner account is aged 18+, bound to agent #1253 through a signed challenge and re-verified against the chain on every visit to `/owner`. No personal attribute is revealed.
2. **A record anyone can check.** Every fetch, calculation, decision, submission, guardrail block and human override is written to a hash-chained, append-only log. Each batch's Merkle root is anchored on Concordium with a RegisterData transaction. The dashboard verifies any entry's Merkle proof in your browser, and an EU AI Act Article 12-style export is one click away.
3. **Paid by other agents.** Full evidence packs are sold over **x402 on Concordium**. A buyer agent checks the seller's badge, pays with a sponsored CCD transfer (our facilitator covers the fee), and receives a pack whose items it can prove were in the anchored log before the market resolved.

## How it works

- `packages/evidence`: keyless primary-data adapters, odds models (volatility for prices, base effects for CPI-style releases, trend for levels), conviction and edge thresholds, a stance lock and novelty checks.
- `packages/ledger`: hash chain, RFC 6962 Merkle proofs, Article 12 export, AES-GCM sealed packs.
- `packages/concordium`: `@concordium/web-sdk` 12 RegisterData anchoring and contract updates, a client for the hosted Agent Registry MCP (card build, register, badge, pin, check), and an x402 paywall plus buyer built on the official `@x402/concordium` package with an in-process facilitator.
- `apps/web`: Next.js dashboard, `/api/packs/{market}` (x402), `/api/mcp` (our own MCP server), `/api/a2a`, and `/.well-known/agent-card.json`.

## Concordium components used

- **Agent Registry + Verified by Concordium badge:** two-pass registration through the hosted MCP's `build_*` tools, signed locally; badge checks before every payment.
- **Concordium ID:** the owner proves age 18+ with a zero-knowledge verifiable presentation from Concordium Wallet for Web, bound to the agent token and checked against the registered owner account (`/owner`, `/api/owner-proof`). No personal data is held, and accountability flows through the registry to the identity provider.
- **x402 payments with sponsored transactions:** buyers never need CCD for fees.
- **Agent Registry MCP server:** used for registration and badge checks. We also expose our own MCP and A2A endpoints.
- **On-chain audit trail:** RegisterData anchors of the log's Merkle roots, plus the Article 12 export.

## Path to production

Mainnet is mostly configuration: contract `<10082,0>`, PLT stablecoin pricing, keys in a KMS, a WORM log store and a hosted facilitator. A Concordium ID proof page binds the human owner to the agent token. Full plan: docs/path-to-production.md.

## Why it matters

Prediction markets and AI oracles need evidence they can trust and trace. Oracle Scout shows what a *trusted agent* looks like in practice: a known accountable owner, a verifiable record of what it knew and when, and machine-to-machine payment for the work. It is also entered in the Delphi Agent Arena, where the same pipeline submits real evidence to live markets.

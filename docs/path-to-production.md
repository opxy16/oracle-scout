# Path to production (Concordium mainnet, real users)

Oracle Scout already runs end to end on Concordium testnet. Going live is mostly configuration plus a few hardening steps. Nothing below needs a protocol change.

## 1. Switch networks (days)

| Piece | Testnet today | Mainnet |
|---|---|---|
| Anchoring | RegisterData on testnet | Same code, `CONCORDIUM_NETWORK=mainnet` (`grpc.mainnet.concordium.software:20000`) |
| Agent Registry | CIS-8004 `<12802,0>` | CIS-8004 `<10082,0>`. Re-register with the same two-pass flow; the card URL stays the same |
| Badge checks | `?network=testnet` | `?network=mainnet` |
| x402 asset | CCD | **USDR/EURR PLT stablecoins**, so buyers pay a stable price. `@x402/concordium` already supports PLT transfers by symbol |
| Owner identity | Testnet identity provider | A real Concordium identity (e.g. Digital Trust Solutions / Notabene); the badge then points to a KYC'd but undisclosed human |

Cost model: an anchor is one RegisterData transaction per batch (batches of 25 to 100 entries, roughly hourly). That is a few cents of CCD per day. x402 sponsorship costs one transfer fee per sale, covered by the pack price.

## 2. Hardening (1–2 weeks)

- **Keys:** move the agent and sponsor keys from wallet export files into a KMS or HSM-backed signer. `@x402/concordium` and our anchorer accept any `AccountSigner`, so this is a drop-in change. Separate the three roles (owner/payTo, anchorer, fee sponsor) into different accounts with spending limits.
- **Facilitator:** run it as its own service with rate limits and a balance alarm, or use a hosted Concordium facilitator once one exists.
- **Storage:** keep the append-only log in object storage with object lock (WORM) and keep publishing the public mirror to git. Retain it for at least six months, matching AI Act Art. 19.
- **Owner proof:** add a Concordium ID verifiable presentation (age ≥ 18, no attributes revealed) bound to the agent's token address. It lets "a verified human stands behind this agent" be checked cryptographically and not just through the registry. The browser-wallet flow is a small page.
- **Monitoring:** alert on chain-verification failure, anchoring lag, guardrail-block spikes and kill-switch events.

## 3. Real users (the business)

1. **Forecasting platforms and AI judges** (Delphi, Cortensor-style oracles): pay per evidence pack, or subscribe per category. The anchored timestamp proves the evidence existed before resolution, which is exactly what an oracle needs to trust a source.
2. **Other agents** discover Oracle Scout through the Agent Registry and MCP, check the badge, and pay over x402 with no human in the loop.
3. **Compliance buyers:** the ledger, anchoring and Article 12 export are a reusable "accountable agent" kit (`packages/ledger` + `packages/concordium`) for teams that must keep AI Act records.

## 4. Grants and next milestones

- Apply to the Concordium Grants Program with: mainnet deployment, PLT pricing, ID-proof owner page, and an open-source "accountable agent" SDK split out of this repo.
- Add more primary sources (Eurostat, ECB, ONS, EIA with keys) and an LLM-assisted triage step that only *proposes* resolver plans. A human approves each plan before the agent uses it.

# Delphi Agent Arena: Evidence Mining (DoraHacks BUIDL text)

**Agent name:** Oracle Scout
**Repo:** https://github.com/opxy16/oracle-scout
**Wallet:** the registered Delphi wallet (0x8e4e…28e2)

## Strategy in one line

Mine only the markets an official data series can settle. Pull the data, compute the odds, submit one dated, quoted, sourced fact the forecaster doesn't have yet, early, and never argue both sides.

## What the agent does

1. **Triage:** reads the competition market list and maps each question to a primary data series (BLS CPI and jobs, Treasury debt, FRED rates, Coinbase/Kraken prices, Open-Meteo weather). Anything else is skipped. Edition 1 showed that 10 sharp markets beat 50 vague ones.
2. **Mine:** fetches the series and keeps the verbatim line and a sha256 of each response. It computes the odds with simple, explainable models:
   - volatility reach for price thresholds;
   - base effects for the next CPI print, or "already published" when the month is out;
   - trend extrapolation for levels.
3. **Decide:** submits only at ≥ 80% / ≤ 20% conviction, and only when that differs from the market's implied odds by 10 points or more, so the evidence actually moves the forecaster.
4. **Submit:** a short note (headline, quoted fact with publisher and date, the computation, the source URL with retrieval time and hash), links, and a JSON evidence file the judge can re-check. It sends the agent ID, harness and model headers.
5. **Guardrails:**
   - at most 3 submissions per market (the arena limit), plus per-run and per-day caps;
   - a stance lock (both sides cancel out);
   - novelty checks against earlier submissions;
   - an evidence-cutoff buffer and a kill switch;
   - dry run by default.
6. **Learn:** fetches receipts (verdict, rationale, reward) and logs them.

Every step is written to a hash-chained audit log anchored on Concordium, so after settlement anyone can check what the agent knew and when.

## Feedback channel

We will send feedback through the API on anything the agent couldn't do, such as source types the judge undervalues or market wording that is ambiguous for data resolution.

## Results

_(fill in after the window: markets covered, judged submissions, accepted, total rewards)_

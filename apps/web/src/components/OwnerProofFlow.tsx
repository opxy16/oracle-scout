"use client";
import { CheckCircle2, CircleDashed, Wallet, XCircle } from "lucide-react";
import { useState } from "react";

/** Minimal shape of the injected Concordium Wallet for Web API (window.concordium). */
interface ConcordiumProvider {
  requestAccounts(): Promise<string[]>;
  getSelectedChain?(): Promise<string | undefined>;
  requestVerifiablePresentation(challenge: string, statements: unknown): Promise<{ toString(): string }>;
}

declare global {
  interface Window {
    concordium?: ConcordiumProvider;
  }
}

async function provider(timeout = 4000): Promise<ConcordiumProvider> {
  if (window.concordium) return window.concordium;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => (window.concordium ? resolve(window.concordium) : reject(new Error("Concordium Wallet for Web not found in this browser"))), timeout);
    window.addEventListener("concordium#initialized", () => {
      clearTimeout(t);
      if (window.concordium) resolve(window.concordium);
    }, { once: true });
  });
}

type Step = "idle" | "connecting" | "challenge" | "proving" | "verifying" | "done" | "error";

export function OwnerProofFlow() {
  const [step, setStep] = useState<Step>("idle");
  const [account, setAccount] = useState<string>();
  const [msg, setMsg] = useState<string>();
  const [result, setResult] = useState<{ ok: boolean; reasons: string[]; account?: string; saved?: boolean }>();

  async function run() {
    setMsg(undefined);
    setResult(undefined);
    try {
      setStep("connecting");
      const p = await provider();
      const accounts = await p.requestAccounts();
      setAccount(accounts[0]);

      setStep("challenge");
      const ch = await fetch("/api/owner-proof/challenge", { cache: "no-store" }).then((r) => r.json());
      if (ch.error) throw new Error(ch.error);
      if (accounts[0] && accounts[0] !== ch.ctx.owner) {
        setMsg(`Heads up: the wallet's selected account is not the agent owner (${ch.ctx.owner.slice(0, 8)}…). When the wallet asks, prove with the owner account.`);
      }

      setStep("proving");
      const pres = await p.requestVerifiablePresentation(ch.challenge, ch.statements);

      setStep("verifying");
      const res = await fetch("/api/owner-proof", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ presentation: pres.toString(), ctx: ch.ctx, sig: ch.sig }),
      }).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      setResult({ ...res.result, saved: res.saved });
      setStep("done");
    } catch (e) {
      setMsg((e as Error)?.message ?? String(e));
      setStep("error");
    }
  }

  const steps: [Step, string][] = [
    ["connecting", "Connect Concordium Wallet for Web"],
    ["challenge", "Get a challenge bound to agent #1253"],
    ["proving", "Approve the proof in your wallet (choose the owner account)"],
    ["verifying", "Server verifies the proof on testnet"],
  ];
  const order: Step[] = ["connecting", "challenge", "proving", "verifying", "done"];
  const at = order.indexOf(step);

  return (
    <div className="panel mt-4 p-5">
      <ol className="space-y-2.5">
        {steps.map(([s, label], i) => {
          const done = at > i || step === "done";
          const active = step === s;
          return (
            <li key={s} className="flex items-center gap-3 text-sm">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${done ? "bg-verify/15 text-verify" : active ? "bg-accent/15 text-accent" : "bg-line/60 text-muted"}`}>
                {done ? "✓" : active ? <CircleDashed className="h-3.5 w-3.5 animate-spin" /> : i + 1}
              </span>
              <span className={done || active ? "" : "text-muted"}>{label}</span>
            </li>
          );
        })}
      </ol>
      {account && <p className="mt-4 font-mono text-xs text-muted">Wallet account: {account}</p>}
      {msg && <p className={`mt-3 text-xs ${step === "error" ? "text-no" : "text-accent"}`}>{msg}</p>}
      {result && (
        <div className={`mt-4 rounded-lg border px-3 py-2 text-sm ${result.ok ? "border-verify/40 bg-verify/5" : "border-no/40 bg-no/5"}`}>
          <p className="flex items-center gap-1.5 font-medium">
            {result.ok ? <CheckCircle2 className="h-4 w-4 text-verify" /> : <XCircle className="h-4 w-4 text-no" />}
            {result.ok ? "Proof verified" : "Proof rejected"}
          </p>
          {!result.ok && <p className="mt-1 text-xs text-muted">{result.reasons.join("; ")}</p>}
          {result.ok && <p className="mt-1 text-xs text-muted">{result.saved ? "Saved to ledger/owner-proof.json for publishing." : "Verified. (Saving happens on the operator's machine.)"}</p>}
        </div>
      )}
      <button
        type="button"
        onClick={run}
        disabled={step !== "idle" && step !== "done" && step !== "error"}
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-50"
      >
        <Wallet className="h-4 w-4" /> {step === "idle" ? "Prove with Concordium ID" : step === "done" || step === "error" ? "Run again" : "Working…"}
      </button>
    </div>
  );
}

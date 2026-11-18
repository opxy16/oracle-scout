import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  AccountAddress,
  CredentialRegistrationId,
  VerifiablePresentation,
  Web3StatementBuilder,
  getPublicData,
  verifyPresentation,
  type CredentialStatements,
} from "@concordium/web-sdk";
import type { ConcordiumGRPCNodeClient } from "@concordium/web-sdk/nodejs";
import type { CcdNetwork } from "./network.js";

/**
 * "A verified human stands behind this agent", proven with Concordium ID and zero knowledge.
 *
 * The owner's wallet proves a statement about the identity behind the owner account
 * (default: age >= 18) without revealing any attribute. We bind the proof to the agent by
 * putting the agent token id and owner account in the signed challenge, and we check that the
 * proving credential belongs to the registered owner account.
 */

export interface ProofContext {
  purpose: "oracle-scout/owner-proof@1";
  tokenId: number;
  badge?: string;
  owner: string;
  minAge: number;
  issuedAt: string;
  nonce: string;
}

const canonical = (c: ProofContext) => JSON.stringify(c, Object.keys(c).sort());

export function challengeOf(ctx: ProofContext): string {
  return createHash("sha256").update(canonical(ctx)).digest("hex");
}

function sign(challenge: string, secret: string): string {
  return createHmac("sha256", `owner-proof:${secret}`).update(challenge).digest("hex");
}

/** Identity providers on testnet: 0 = Concordium testnet IP (plus others listed by the wallet proxy). */
export function ownerStatements(minAge: number, identityProviders: number[]): CredentialStatements {
  return new Web3StatementBuilder().addForIdentityCredentials(identityProviders, (b) => b.addMinimumAge(minAge)).getStatements();
}

export function issueChallenge(args: { tokenId: number; badge?: string; owner: string; minAge?: number; secret: string; now?: Date }) {
  const ctx: ProofContext = {
    purpose: "oracle-scout/owner-proof@1",
    tokenId: args.tokenId,
    badge: args.badge,
    owner: args.owner,
    minAge: args.minAge ?? 18,
    issuedAt: (args.now ?? new Date()).toISOString(),
    nonce: randomBytes(12).toString("hex"),
  };
  const challenge = challengeOf(ctx);
  return { ctx, challenge, sig: sign(challenge, args.secret) };
}

export interface OwnerProofResult {
  ok: boolean;
  reasons: string[];
  challenge: string;
  credId?: string;
  account?: string;
  statement?: unknown;
  verifiedAt: string;
}

export async function verifyOwnerProof(args: {
  presentation: string;
  ctx: ProofContext;
  sig: string;
  secret: string;
  expectedOwner: string;
  client: ConcordiumGRPCNodeClient;
  network: CcdNetwork;
  /** Reject challenges older than this (fresh proofs only); omit when re-verifying a published proof. */
  maxAgeMs?: number;
  now?: Date;
}): Promise<OwnerProofResult> {
  const reasons: string[] = [];
  const challenge = challengeOf(args.ctx);
  const out: OwnerProofResult = { ok: false, reasons, challenge, verifiedAt: (args.now ?? new Date()).toISOString() };

  const expectedSig = Buffer.from(sign(challenge, args.secret), "hex");
  const givenSig = Buffer.from(/^[0-9a-f]{64}$/.test(args.sig) ? args.sig : "00".repeat(32), "hex");
  if (!timingSafeEqual(expectedSig, givenSig)) reasons.push("challenge was not issued by this server");
  if (args.ctx.owner !== args.expectedOwner) reasons.push("challenge names a different owner account");
  if (args.maxAgeMs !== undefined && (args.now ?? new Date()).getTime() - Date.parse(args.ctx.issuedAt) > args.maxAgeMs) reasons.push("challenge expired");
  if (reasons.length) return out;

  let pres: VerifiablePresentation;
  try {
    pres = VerifiablePresentation.fromString(args.presentation);
  } catch (e) {
    reasons.push(`malformed presentation: ${(e as Error).message}`);
    return out;
  }

  try {
    const network = args.network.name === "mainnet" ? "Mainnet" : "Testnet";
    const publicData = await getPublicData(args.client, network, pres);
    const inactive = publicData.filter((p) => String(p.status) !== "0" && String(p.status).toLowerCase() !== "active");
    if (inactive.length) reasons.push("credential is not active");
    const globalContext = await args.client.getCryptographicParameters();
    const request = verifyPresentation(pres, globalContext, publicData.map((p) => p.inputs));
    if (request.challenge !== challenge) reasons.push("proof answers a different challenge");
    const cs = request.credentialStatements[0] as { id: string; statement: unknown } | undefined;
    if (!cs) reasons.push("no credential statement in proof");
    else {
      out.statement = cs.statement;
      const credId = cs.id.split(":").pop()!;
      out.credId = credId;
      const info = await args.client.getAccountInfo(CredentialRegistrationId.fromHexString(credId));
      out.account = AccountAddress.toBase58(info.accountAddress);
      if (out.account !== args.expectedOwner) reasons.push(`proving credential belongs to ${out.account}, not the agent owner`);
      const minAgeOk = JSON.stringify(cs.statement).includes('"attributeTag":"dob"');
      if (!minAgeOk) reasons.push("statement is not the requested date-of-birth range");
    }
  } catch (e) {
    reasons.push(`cryptographic verification failed: ${(e as Error).message}`);
  }
  out.ok = reasons.length === 0;
  return out;
}

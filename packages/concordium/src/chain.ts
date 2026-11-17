import { readFileSync } from "node:fs";
import {
  AccountAddress,
  CcdAmount,
  ContractAddress,
  DataBlob,
  Energy,
  Parameter,
  ReceiveName,
  SequenceNumber,
  TransactionExpiry,
  TransactionHash,
  buildAccountSigner,
  parseWallet,
  type AccountSigner,
} from "@concordium/web-sdk";
import { ConcordiumGRPCNodeClient, credentials } from "@concordium/web-sdk/nodejs";
import { Transaction } from "@concordium/web-sdk/transactions";
import { explorerTx, type CcdNetwork } from "./network.js";

/**
 * Key handling rule: keys only ever come from a Concordium Wallet export file whose path
 * is given in a git-ignored env file. This module never logs, returns or serialises keys;
 * callers get an address and an opaque signer.
 */
export interface Account {
  address: string;
  signer: AccountSigner;
}

export function loadWalletExport(path: string): Account {
  return walletFromJson(readFileSync(path, "utf8"));
}

/** Same as loadWalletExport, from the file's contents (e.g. a secret env var on a host without files). */
export function walletFromJson(json: string): Account {
  const wallet = parseWallet(json);
  return { address: wallet.value.address, signer: buildAccountSigner(wallet) };
}

export function grpcClient(n: CcdNetwork): ConcordiumGRPCNodeClient {
  return new ConcordiumGRPCNodeClient(n.grpcHost, n.grpcPort, credentials.createSsl(), { timeout: 15_000 });
}

export interface SentTx {
  txHash: string;
  explorerUrl: string;
  blockHash?: string;
}

async function submit(
  client: ConcordiumGRPCNodeClient,
  n: CcdNetwork,
  account: Account,
  build: (meta: { sender: AccountAddress.Type; nonce: SequenceNumber.Type; expiry: TransactionExpiry.Type }) => Transaction.Signable,
): Promise<SentTx> {
  const sender = AccountAddress.fromBase58(account.address);
  const { nonce } = await client.getNextAccountNonce(sender);
  const signable = build({ sender, nonce, expiry: TransactionExpiry.futureMinutes(5) });
  const finalized = await Transaction.signAndFinalize(signable, account.signer);
  const hash = await client.sendTransaction(finalized);
  const outcome = await client.waitForTransactionFinalization(hash, 120_000);
  const summary = outcome.summary as { type?: string; transactionType?: string; rejectReason?: unknown };
  if (summary.rejectReason) throw new Error(`Transaction rejected: ${JSON.stringify(summary.rejectReason, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
  const txHash = TransactionHash.toHexString(hash);
  return { txHash, explorerUrl: explorerTx(n, txHash), blockHash: String(outcome.blockHash) };
}

/** RegisterData: put up to 256 bytes on chain. */
export function registerData(client: ConcordiumGRPCNodeClient, n: CcdNetwork, account: Account, data: Uint8Array): Promise<SentTx> {
  if (data.length > 256) throw new Error(`RegisterData payload is ${data.length} bytes (max 256)`);
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  return submit(client, n, account, (m) => Transaction.registerData({ data: new DataBlob(buf) }).addMetadata(m).build());
}

/** Contract update from a hosted-MCP `build_*` result (receive_name + parameter_hex + suggested_energy). */
export function updateContract(
  client: ConcordiumGRPCNodeClient,
  n: CcdNetwork,
  account: Account,
  built: { contract_address: { index: number; subindex: number }; receive_name: string; parameter_hex: string; suggested_energy?: number },
): Promise<SentTx> {
  const payload = {
    amount: CcdAmount.zero(),
    address: ContractAddress.create(BigInt(built.contract_address.index), BigInt(built.contract_address.subindex)),
    receiveName: ReceiveName.fromString(built.receive_name),
    message: Parameter.fromHexString(built.parameter_hex),
  };
  const energy = Energy.create(BigInt(built.suggested_energy ?? 30_000));
  return submit(client, n, account, (m) => Transaction.updateContract(payload, energy).addMetadata(m).build());
}

/**
 * Compact, human-readable anchor memo, CBOR-encoded as a text string so explorers
 * decode it: "oracle-scout/1 <agent> b=<batch> seq=<from>-<to> root=<hex>".
 */
export function anchorMemo(agentId: string, batch: { batch: number; fromSeq: number; toSeq: number; root: string }): Uint8Array {
  const text = `oracle-scout/1 ${agentId.slice(0, 40)} b=${batch.batch} seq=${batch.fromSeq}-${batch.toSeq} root=${batch.root}`;
  return cborText(text);
}

export function cborText(text: string): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  const n = bytes.length;
  const head = n < 24 ? [0x60 | n] : n < 256 ? [0x78, n] : [0x79, n >> 8, n & 0xff];
  const out = new Uint8Array(head.length + n);
  out.set(head, 0);
  out.set(bytes, head.length);
  return out;
}

export function decodeCborText(bytes: Uint8Array): string | null {
  const b0 = bytes[0];
  if (b0 === undefined || b0 >> 5 !== 3) return null;
  const info = b0 & 0x1f;
  const [len, off] = info < 24 ? [info, 1] : info === 24 ? [bytes[1]!, 2] : info === 25 ? [(bytes[1]! << 8) | bytes[2]!, 3] : [-1, 0];
  if (len < 0 || off + len > bytes.length) return null;
  return new TextDecoder().decode(bytes.slice(off, off + len));
}

/** Read back a RegisterData anchor and return the memo text (for independent verification). */
export async function readAnchor(client: ConcordiumGRPCNodeClient, txHash: string): Promise<string | null> {
  const status = await client.getBlockItemStatus(TransactionHash.fromHexString(txHash));
  if (status.status !== "finalized") return null;
  const summary = status.outcome.summary as { dataRegistered?: { data: string } };
  const hex = summary.dataRegistered?.data;
  if (!hex) return null;
  return decodeCborText(Uint8Array.from(Buffer.from(hex, "hex")));
}

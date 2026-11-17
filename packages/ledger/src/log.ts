import { canonicalJson, hashObject, sha256Hex } from "./hash.js";
import { merkleRoot } from "./merkle.js";

/** Event kinds the agent records. Kept small and stable: exports and dashboards key on them. */
export type EventKind =
  | "run.start"
  | "run.end"
  | "market.triage"
  | "source.fetch"
  | "analysis"
  | "evidence.created"
  | "evidence.submitted"
  | "evidence.receipt"
  | "guardrail.block"
  | "oversight"
  | "anchor"
  | "pack.sold"
  | "error";

export const GENESIS = "0".repeat(64);

export interface LogEntry<P = unknown> {
  v: 1;
  seq: number;
  ts: string;
  kind: EventKind;
  actor: string;
  /** May be dropped from exports (e.g. erasure requests); payloadHash keeps the chain intact. */
  payload?: P;
  payloadHash: string;
  prevHash: string;
  entryHash: string;
}

export interface AnchorRecord {
  batch: number;
  fromSeq: number;
  toSeq: number;
  count: number;
  root: string;
  /** entryHash of toSeq: pins the hash chain head as well as the batch. */
  head: string;
  network: string;
  txHash: string;
  explorerUrl?: string;
  anchoredAt: string;
}

export interface LogStore {
  readAll(): Promise<LogEntry[]>;
  append(entry: LogEntry): Promise<void>;
}

export class MemoryStore implements LogStore {
  constructor(private readonly items: LogEntry[] = []) {}
  async readAll() {
    return [...this.items];
  }
  async append(entry: LogEntry) {
    this.items.push(entry);
  }
}

export function entryHashOf(e: Omit<LogEntry, "entryHash" | "payload">): string {
  return hashObject({ v: e.v, seq: e.seq, ts: e.ts, kind: e.kind, actor: e.actor, payloadHash: e.payloadHash, prevHash: e.prevHash });
}

export interface ChainCheck {
  ok: boolean;
  checked: number;
  errors: string[];
}

/** Recompute every hash and link. Payload-less (redacted) entries are checked by payloadHash only. */
export function verifyChain(entries: LogEntry[]): ChainCheck {
  const errors: string[] = [];
  let prev = GENESIS;
  entries.forEach((e, i) => {
    if (e.seq !== i) errors.push(`seq ${e.seq} at position ${i}`);
    if (e.prevHash !== prev) errors.push(`seq ${e.seq}: prevHash does not link to previous entry`);
    if (e.payload !== undefined && sha256Hex(canonicalJson(e.payload)) !== e.payloadHash)
      errors.push(`seq ${e.seq}: payload was altered`);
    if (entryHashOf(e) !== e.entryHash) errors.push(`seq ${e.seq}: entryHash mismatch`);
    prev = e.entryHash;
  });
  return { ok: errors.length === 0, checked: entries.length, errors };
}

export interface PendingBatch {
  batch: number;
  fromSeq: number;
  toSeq: number;
  count: number;
  root: string;
  head: string;
  entryHashes: string[];
}

/**
 * Append-only, hash-chained audit log. Every entry commits to the one before it,
 * and batches of entries are committed to a Merkle root that gets anchored on chain.
 */
export class AuditLog {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: LogStore,
    readonly actor: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  entries(): Promise<LogEntry[]> {
    return this.store.readAll();
  }

  append<P>(kind: EventKind, payload: P): Promise<LogEntry<P>> {
    const run = this.queue.then(async () => {
      const all = await this.store.readAll();
      const last = all[all.length - 1];
      const base = {
        v: 1 as const,
        seq: all.length,
        ts: this.clock().toISOString(),
        kind,
        actor: this.actor,
        payloadHash: sha256Hex(canonicalJson(payload)),
        prevHash: last ? last.entryHash : GENESIS,
      };
      const entry: LogEntry<P> = { ...base, payload, entryHash: entryHashOf(base) };
      await this.store.append(entry);
      return entry;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async anchors(): Promise<AnchorRecord[]> {
    return (await this.entries()).filter((e) => e.kind === "anchor").map((e) => e.payload as AnchorRecord);
  }

  /** Entries not yet covered by an anchor (the anchor entries themselves roll into the next batch). */
  async pendingBatch(): Promise<PendingBatch | null> {
    const all = await this.entries();
    const anchors = all.filter((e) => e.kind === "anchor").map((e) => e.payload as AnchorRecord);
    const last = anchors[anchors.length - 1];
    const fromSeq = last ? last.toSeq + 1 : 0;
    const slice = all.slice(fromSeq);
    if (slice.length === 0) return null;
    const entryHashes = slice.map((e) => e.entryHash);
    return {
      batch: anchors.length,
      fromSeq,
      toSeq: fromSeq + slice.length - 1,
      count: slice.length,
      root: merkleRoot(entryHashes),
      head: slice[slice.length - 1]!.entryHash,
      entryHashes,
    };
  }

  recordAnchor(anchor: AnchorRecord): Promise<LogEntry<AnchorRecord>> {
    return this.append("anchor", anchor);
  }
}

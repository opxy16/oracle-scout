import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { LogEntry, LogStore } from "./log.js";

/** JSON Lines file store: one entry per line, only ever appended to. Node only. */
export class JsonlFileStore implements LogStore {
  private cache: LogEntry[] | null = null;

  constructor(readonly path: string) {}

  async readAll(): Promise<LogEntry[]> {
    if (this.cache) return [...this.cache];
    let text = "";
    try {
      text = await readFile(this.path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    this.cache = text
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as LogEntry);
    return [...this.cache];
  }

  async append(entry: LogEntry): Promise<void> {
    await this.readAll();
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(entry) + "\n", "utf8");
    this.cache!.push(entry);
  }
}


/**
 * Sealed packs: evidence packs are published encrypted (AES-256-GCM) so the public repo
 * holds only ciphertext; the paid endpoint decrypts after an x402 settlement.
 * The plaintext hash is committed in the anchored audit log, so buyers can check that
 * what they bought is exactly what was logged (and when).
 */
export interface SealedBox {
  v: 1;
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  data: string;
}

function keyBytes(keyB64: string): Buffer {
  const k = Buffer.from(keyB64, "base64");
  if (k.length !== 32) throw new Error("pack key must be 32 bytes, base64-encoded");
  return k;
}

export function seal(plaintext: string, keyB64: string): SealedBox {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyBytes(keyB64), iv);
  const data = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return { v: 1, alg: "aes-256-gcm", iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
}

export function unseal(box: SealedBox, keyB64: string): string {
  const d = createDecipheriv("aes-256-gcm", keyBytes(keyB64), Buffer.from(box.iv, "base64"));
  d.setAuthTag(Buffer.from(box.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(box.data, "base64")), d.final()]).toString("utf8");
}

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

export { bytesToHex, hexToBytes };

/** sha256 of a UTF-8 string or raw bytes, as lowercase hex. Works in Node and browsers. */
export function sha256Hex(data: string | Uint8Array): string {
  return bytesToHex(sha256(typeof data === "string" ? utf8ToBytes(data) : data));
}

/**
 * Canonical JSON: object keys sorted recursively, no whitespace, `undefined` dropped.
 * Two parties that hold the same logical object always produce the same bytes,
 * which is what makes the hashes in the audit log reproducible by anyone.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortDeep(v);
    }
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("canonicalJson: non-finite numbers cannot be hashed reproducibly");
  }
  return value;
}

export function hashObject(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

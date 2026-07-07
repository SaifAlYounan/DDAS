/**
 * RFC 8785 (JSON Canonicalization Scheme) for I-JSON data.
 *
 * JCS number serialization is defined as ECMAScript Number::toString and JCS
 * string escaping is exactly JSON.stringify's, so a recursive serializer that
 * sorts object keys by UTF-16 code units and delegates scalars to
 * JSON.stringify is fully compliant for the data this repo produces (policies,
 * derivations, audit payloads — plain I-JSON, enforced by schema).
 * Pinned against the RFC 8785 appendix test vectors in jcs.test.ts.
 */
import { createHash } from "node:crypto";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("JCS: non-finite numbers are not valid JSON");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalize(v === undefined ? null : v)).join(",") + "]";
  }
  const keys = Object.keys(value).sort(); // Array.prototype.sort is UTF-16 code-unit order
  const parts: string[] = [];
  for (const key of keys) {
    const v = value[key];
    if (v === undefined) continue; // mirror JSON.stringify: undefined members are dropped
    parts.push(JSON.stringify(key) + ":" + canonicalize(v));
  }
  return "{" + parts.join(",") + "}";
}

/** sha256 over the canonical bytes, hex, prefixed — the content-hash format used repo-wide. */
export function contentHash(value: JsonValue): string {
  return "sha256:" + createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

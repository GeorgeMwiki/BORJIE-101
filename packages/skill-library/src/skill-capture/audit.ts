/**
 * Append-only audit hashing for the skill-capture loop.
 *
 * Every capture event is hash-chained: `rowHash = sha256(canonicalJson({
 * prev, payload }))`, genesis row hashed against `GENESIS_HASH`. This is
 * the SAME scheme `@borjie/audit-hash-chain` and the
 * dynamic-recipe-authoring chain use — re-implemented locally with only
 * `node:crypto` so `@borjie/skill-library` keeps its zero-extra-runtime-
 * dependency promise (node:crypto is a built-in, already in `types`).
 *
 * Pure + deterministic given the same `prev` + payload. No I/O.
 *
 * @module @borjie/skill-library/skill-capture/audit
 */

import { createHash } from 'node:crypto';

/** Genesis sentinel — matches `@borjie/audit-hash-chain`. */
export const GENESIS_HASH = 'GENESIS' as const;

/**
 * Canonical JSON: object keys sorted recursively so the hash is stable
 * regardless of insertion order. Mirrors the audit-hash-chain canonicaliser.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Compute the chained capture-event hash. `prev` defaults to GENESIS for
 * the first capture in a chain.
 */
export function captureAuditHash(
  payload: Readonly<Record<string, unknown>>,
  prevHash: string = GENESIS_HASH,
): string {
  const canonical = canonicalJson({ prev: prevHash, payload });
  return createHash('sha256').update(canonical).digest('hex');
}

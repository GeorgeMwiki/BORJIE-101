/**
 * Audit-chain hashing utilities.
 *
 * `canonicalJSON` produces a deterministic string serialization with
 * sorted keys at every depth — so the same logical content hashes to
 * the same digest regardless of key insertion order. `sha256Hex`
 * returns a 64-char lowercase hex digest. Both are pure functions.
 *
 * Used by `sealResult` (audit hash on every RecommendationResult)
 * and by `recommendation-repository` (audit hash on every persisted
 * row and feedback signal — see migration 0071 for the SQL audit
 * chain layout).
 */

import { createHash } from 'node:crypto';

export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJSON(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`,
  );
  return `{${pairs.join(',')}}`;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function sha256Short(input: string): string {
  return sha256Hex(input).slice(0, 16);
}

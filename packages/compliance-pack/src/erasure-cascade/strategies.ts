/**
 * Per-strategy column transformations.
 *
 * Pure: take a row + columns + tenant, return the new column-state.
 * The cascade engine wraps these in a transaction (in the integration
 * layer) so partial failures are rolled back.
 */

import { createHash } from 'node:crypto';

import type { ErasureStrategy } from '../types.js';

/**
 * Stable anonymization — replace value with a deterministic hash of
 * (tenantId + column + value). Same input always yields same hash, so
 * downstream joins on the anonymized column still work; the original
 * value cannot be recovered from the hash alone.
 */
export function anonymizeValue(
  tenantId: string,
  column: string,
  value: unknown,
): string {
  const h = createHash('sha256');
  h.update(tenantId);
  h.update('\x00');
  h.update(column);
  h.update('\x00');
  h.update(JSON.stringify(value ?? null));
  // Prefix marks the field as anonymized so a reader cannot mistake
  // the hash for a normal value.
  return `anon::${h.digest('hex').substring(0, 32)}`;
}

/**
 * Pseudonymization — replace value with an opaque token whose mapping
 * is held in a separate per-tenant lookup. We emit the token here;
 * the integration layer is responsible for writing the
 * `pseudonymization_lookup(tenant_id, column, token, ciphertext)` row.
 *
 * The token's secret bytes come from the random source the caller
 * supplies (so tests can be deterministic).
 */
export function pseudonymizeValue(
  tenantId: string,
  column: string,
  rand: (bytes: number) => string,
): string {
  const token = rand(16);
  return `pseud::${tenantId}::${column}::${token}`;
}

/**
 * Tombstone marker — replaces the entire row payload with a fixed
 * shape that downstream readers can detect.
 */
export function tombstoneRow(now: Date): Readonly<Record<string, unknown>> {
  return Object.freeze({
    __tombstoned__: true,
    erased_at: now.toISOString(),
  });
}

/**
 * Strategy priority — `legal_hold` always wins; among the rest,
 * higher index = stronger erasure. The cascade engine uses this to
 * collapse duplicate rules on the same table.
 */
const PRIORITY: Readonly<Record<ErasureStrategy, number>> = {
  legal_hold: 100,
  hard_delete: 50,
  pseudonymize: 40,
  anonymize: 30,
  tombstone: 20,
};

export function strategyPriority(strategy: ErasureStrategy): number {
  return PRIORITY[strategy];
}

export function strongerStrategy(
  a: ErasureStrategy,
  b: ErasureStrategy,
): ErasureStrategy {
  return strategyPriority(a) >= strategyPriority(b) ? a : b;
}

/**
 * Break-glass access-log hash chain (INV-A / FIRE-1).
 *
 * Pure, DB-free helpers so the chain logic is unit-testable in isolation.
 * Each access-log entry binds its predecessor via SHA-256; a single mutation
 * anywhere in a tenant's chain breaks `verifyChain` from that point on. This
 * is the Access-Transparency guarantee the invariant requires.
 */

import { createHash } from 'node:crypto';
import { GENESIS_HASH } from './types';

export interface ChainableEntry {
  readonly tenantId: string;
  readonly grantId: string;
  readonly operatorId: string;
  readonly seq: number;
  readonly route: string;
  readonly scope: string;
  readonly rowCount: number;
  readonly accessedAt: string;
  readonly prevHash: string;
  readonly thisHash: string;
}

/**
 * Canonical, order-stable serialization of the load-bearing fields. Excludes
 * `thisHash` (it is the output) and any free-form metadata (kept out of the
 * chain so redaction never breaks verification).
 */
export function canonicalEntry(
  entry: Omit<ChainableEntry, 'thisHash'>,
): string {
  return JSON.stringify({
    tenantId: entry.tenantId,
    grantId: entry.grantId,
    operatorId: entry.operatorId,
    seq: entry.seq,
    route: entry.route,
    scope: entry.scope,
    rowCount: entry.rowCount,
    accessedAt: entry.accessedAt,
    prevHash: entry.prevHash,
  });
}

/** SHA-256 over (prevHash + canonical entry). */
export function computeHash(entry: Omit<ChainableEntry, 'thisHash'>): string {
  return createHash('sha256')
    .update(entry.prevHash)
    .update(canonicalEntry(entry))
    .digest('hex');
}

/**
 * Verify an ordered (by seq, ascending) slice of one tenant's chain.
 * Returns `{ ok: true }` or the seq where the chain first broke.
 */
export function verifyChain(
  entries: readonly ChainableEntry[],
): { ok: true } | { ok: false; brokenAtSeq: number } {
  let expectedPrev = GENESIS_HASH;
  for (const entry of entries) {
    if (entry.prevHash !== expectedPrev) {
      return { ok: false, brokenAtSeq: entry.seq };
    }
    const recomputed = computeHash(entry);
    if (recomputed !== entry.thisHash) {
      return { ok: false, brokenAtSeq: entry.seq };
    }
    expectedPrev = entry.thisHash;
  }
  return { ok: true };
}

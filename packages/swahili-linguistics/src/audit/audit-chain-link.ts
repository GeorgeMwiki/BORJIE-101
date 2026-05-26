/**
 * Audit-chain integration for swahili-linguistics (Wave 19H).
 *
 * Every row in `swahili_terms`, `swahili_morphology_cache` and
 * `swahili_dialect_signals` carries an `audit_hash` that chains into
 * the canonical Wave 18S audit-hash chain. This helper computes the
 * row hash given a canonicalisable payload.
 */

import { chainHash, GENESIS_HASH } from '@borjie/audit-hash-chain';

export function computeSwahiliAuditHash(
  payload: Readonly<Record<string, unknown>>,
  prevHash: string = GENESIS_HASH,
): string {
  return chainHash({ prev: prevHash, payload });
}

export { GENESIS_HASH };

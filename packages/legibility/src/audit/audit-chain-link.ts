/**
 * Audit-chain integration for legibility.
 *
 * Wave M6. Every `legibility_snapshots` row and every
 * `legibility_deltas` row carries an `audit_hash`. The hash is
 * computed deterministically from a canonicalised payload (same
 * primitive as Wave 18S / 18HH / M5).
 */

import { chainHash, GENESIS_HASH } from '@borjie/audit-hash-chain';

export function computeLegibilityAuditHash(
  payload: Readonly<Record<string, unknown>>,
  prevHash: string = GENESIS_HASH,
): string {
  return chainHash({ prev: prevHash, payload });
}

export { GENESIS_HASH };

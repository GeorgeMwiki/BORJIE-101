/**
 * Audit-chain integration for tab-as-loop.
 *
 * Wave M5. Every `tab_sessions` row and every `tab_events` row carries
 * an `audit_hash`. Sessions also carry `prev_hash` so the per-session
 * chain can be verified forward from the row that opened it.
 *
 * The hash is computed deterministically from a canonicalised payload
 * (same `chainHash` primitive as Wave 18S / 18HH).
 */

import { chainHash, GENESIS_HASH } from '@borjie/audit-hash-chain';

/**
 * Compute the audit hash for a tab-session or tab-event row.
 *
 * Deterministic: same payload + same `prevHash` → same hash. Callers
 * pass the prev_hash they want to chain into; for the very first
 * session-open we chain into `GENESIS_HASH`.
 */
export function computeTabAuditHash(
  payload: Readonly<Record<string, unknown>>,
  prevHash: string = GENESIS_HASH,
): string {
  return chainHash({ prev: prevHash, payload });
}

export { GENESIS_HASH };

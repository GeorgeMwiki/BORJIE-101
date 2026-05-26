/**
 * Audit-chain integration for `@borjie/strategic-layer`.
 *
 * Every row in `north_star_objectives`, `objective_progress`,
 * `pivot_proposals`, `federation_consents`, `epsilon_budgets`, and
 * `epsilon_ledger` carries an `audit_hash` that chains into the
 * canonical Wave 18S audit hash chain (PO-14). This helper computes
 * the entry hash for a strategic-layer row.
 *
 * Pure function — deterministic, no I/O.
 */

import { chainHash, GENESIS_HASH } from '@borjie/audit-hash-chain';

/**
 * Compute the audit hash for a strategic-layer row given a
 * canonicalisable payload object. Deterministic: same input → same hash.
 *
 * Used by:
 *   - ObjectiveManager  (create / activate / retire / met / missed)
 *   - ProgressTracker   (observe)
 *   - PivotProposer     (propose / accept / reject / expire)
 *   - ConsentManager    (grant / revoke / expire)
 *   - EpsilonBudget     (initialise / charge)
 */
export function computeStrategicAuditHash(
  payload: Readonly<Record<string, unknown>>,
  prevHash: string = GENESIS_HASH,
): string {
  return chainHash({ prev: prevHash, payload });
}

export { GENESIS_HASH };

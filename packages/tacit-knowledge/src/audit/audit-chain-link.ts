/**
 * Audit-chain integration for tacit-knowledge.
 *
 * Wave HARVEST. Every row in `tacit_interviews`, `tacit_extractions`,
 * and `tacit_consents` carries an `audit_hash` that chains into the
 * canonical Wave 18S audit hash chain. This helper computes the entry
 * hash for a tacit-knowledge row.
 *
 * Mirrors the content-only hashing variant used by swarm-coordination
 * (Wave 18HH) — the rows are forensically traceable without being on
 * the global mutation audit chain.
 */

import { chainHash, GENESIS_HASH } from '@borjie/audit-hash-chain';

/**
 * Compute the audit hash for a tacit-knowledge row given a
 * canonicalisable payload object. Deterministic: same input → same
 * hash.
 */
export function computeTacitAuditHash(
  payload: Readonly<Record<string, unknown>>,
  prevHash: string = GENESIS_HASH,
): string {
  return chainHash({ prev: prevHash, payload });
}

export { GENESIS_HASH };

/**
 * Audit-chain integration for swarm-coordination.
 *
 * Wave 18HH. Every row in `active_agents`, `agent_messages`,
 * `blackboard_postings`, and `coordination_conflicts` carries an
 * `audit_hash` that chains into the canonical Wave 18S audit hash
 * chain. This helper computes the entry hash for a swarm row.
 *
 * We use the *content-only* hashing variant — the swarm-coordination
 * rows are not themselves on the global audit chain (they describe
 * coordination, not mutations) — but the hash is forensic-quality so
 * tampered rows can be detected after the fact.
 */

import { chainHash, GENESIS_HASH } from '@borjie/audit-hash-chain';

/**
 * Compute the audit hash for a swarm-coordination row given a
 * canonicalisable payload object. Deterministic: same input → same hash.
 *
 * Used by:
 *   - active-agents-registry (register/heartbeat/deregister)
 *   - a2a-sender (send)
 *   - blackboard-poster (post)
 *   - conflict-detector (open)
 */
export function computeSwarmAuditHash(
  payload: Readonly<Record<string, unknown>>,
  prevHash: string = GENESIS_HASH,
): string {
  return chainHash({ prev: prevHash, payload });
}

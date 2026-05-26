/**
 * Audit-chain integration for internal-software-generator.
 *
 * Every `internal_tools` row carries an `audit_hash` + `prev_hash` so
 * the per-tenant tool chain is verifiable end-to-end. Every
 * `internal_tool_runs` row carries an `audit_hash` so the run ledger
 * is forensically verifiable (no row can be quietly inserted or
 * mutated without invalidating the hash).
 */

import { chainHash, GENESIS_HASH } from '@borjie/audit-hash-chain';

export function computeToolAuditHash(
  payload: Readonly<Record<string, unknown>>,
  prevHash: string = GENESIS_HASH,
): string {
  return chainHash({ prev: prevHash, payload });
}

export { GENESIS_HASH };

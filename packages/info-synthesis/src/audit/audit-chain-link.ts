/**
 * Audit-chain integration for info-synthesis.
 *
 * Every `synth_runs` and `synth_outputs` row carries an `audit_hash`.
 * Each synth_run also stores `prev_hash` so the per-tenant synth chain
 * is verifiable end-to-end. This helper computes the audit hash for a
 * given payload + previous hash.
 */

import { chainHash, GENESIS_HASH } from '@borjie/audit-hash-chain';

export function computeSynthAuditHash(
  payload: Readonly<Record<string, unknown>>,
  prevHash: string = GENESIS_HASH,
): string {
  return chainHash({ prev: prevHash, payload });
}

export { GENESIS_HASH };

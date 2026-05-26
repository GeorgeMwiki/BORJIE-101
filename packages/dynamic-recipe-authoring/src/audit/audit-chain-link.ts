/**
 * Audit-chain integration for dynamic-recipe-authoring.
 *
 * Every `dynamic_authored_recipes` row carries an `audit_hash` +
 * `prev_hash` so the per-tenant authoring chain is verifiable end-to-
 * end. The composition is identical to the audit-hash scheme used by
 * `@borjie/internal-software-generator` and the catalogue: each row
 * hashes its payload against the prior row's hash, with the genesis
 * row hashed against `GENESIS_HASH`.
 *
 * @module @borjie/dynamic-recipe-authoring/audit/audit-chain-link
 */

import { chainHash, GENESIS_HASH } from '@borjie/audit-hash-chain';

export function computeAuthoredRecipeAuditHash(
  payload: Readonly<Record<string, unknown>>,
  prevHash: string = GENESIS_HASH,
): string {
  return chainHash({ prev: prevHash, payload });
}

export { GENESIS_HASH };

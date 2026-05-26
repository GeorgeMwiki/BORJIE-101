/**
 * Audit-chain integration for translation-sota.
 *
 * Every `translation_runs`, `translation_glossary_overrides` and
 * `translation_evals` row carries an `audit_hash`. The runs table also
 * carries `prev_hash` so the per-tenant translation chain is
 * verifiable end-to-end. This helper computes the audit hash for a
 * given payload + previous hash.
 *
 * Pure delegation to `@borjie/audit-hash-chain`; kept thin so the rest
 * of the package never imports the canonical-json + chain primitives
 * directly.
 */

import { chainHash, GENESIS_HASH } from '@borjie/audit-hash-chain';

export function computeTranslationAuditHash(
  payload: Readonly<Record<string, unknown>>,
  prevHash: string = GENESIS_HASH,
): string {
  return chainHash({ prev: prevHash, payload });
}

export { GENESIS_HASH };

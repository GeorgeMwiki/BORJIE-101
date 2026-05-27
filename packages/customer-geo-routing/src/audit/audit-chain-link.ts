/**
 * Audit-chain link factory — builds the hash entries appended to the
 * customer-routing + session-scope audit streams.
 *
 * Routes through `@borjie/audit-hash-chain` so the same canonical-JSON
 * + sha256 algorithm is used everywhere.
 */

import { hashChainEntry, GENESIS_HASH } from '@borjie/audit-hash-chain';
import type { AuditPayload } from '@borjie/audit-hash-chain';

export interface LinkInput {
  readonly payload: AuditPayload;
  readonly previousHash?: string;
  readonly sealedAtIso?: string;
  readonly secretId?: string;
  readonly secretValue?: string;
}

export interface LinkOutput {
  readonly rowHash: string;
  readonly prevHash: string;
  readonly sealedAtIso: string;
}

/**
 * Produce the rowHash for a routing or scope-switch event. Defaults
 * the `previousHash` to the genesis sentinel and `sealedAtIso` to the
 * current wall-clock ISO when the caller does not supply them.
 */
export function buildAuditLink(input: LinkInput): LinkOutput {
  const prev = input.previousHash ?? GENESIS_HASH;
  const sealed = input.sealedAtIso ?? new Date().toISOString();
  const rowHash = hashChainEntry({
    prev,
    payload: input.payload,
    ...(input.secretId !== undefined ? { secretId: input.secretId } : {}),
    ...(input.secretValue !== undefined ? { secretValue: input.secretValue } : {}),
  });
  return {
    rowHash,
    prevHash: prev,
    sealedAtIso: sealed,
  };
}

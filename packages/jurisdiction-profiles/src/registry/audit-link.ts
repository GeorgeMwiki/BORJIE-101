/**
 * Audit-link helper — wraps `@borjie/audit-hash-chain` to produce a
 * stable hash for a registry row given the previous-row hash. Each
 * registry row (profile / framework / mapping / regulator) carries
 * an `audit_hash` field; this helper produces it.
 *
 * Pure function. Genesis row uses GENESIS_HASH (no prev).
 */

import { GENESIS_HASH, hashChainEntry } from '@borjie/audit-hash-chain';
import type { AuditPayload } from '@borjie/audit-hash-chain';

export function linkRegistryRow(args: {
  readonly kind: 'profile' | 'framework' | 'mapping' | 'regulator';
  readonly id: string;
  readonly prev?: string;
  readonly payload?: AuditPayload;
}): string {
  const payload: AuditPayload = args.payload ?? {
    kind: args.kind,
    id: args.id,
  };
  return hashChainEntry({
    prev: args.prev ?? GENESIS_HASH,
    payload,
  });
}

export { GENESIS_HASH };

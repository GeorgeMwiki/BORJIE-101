/**
 * Audit-chain link helper (Wave 18GG).
 *
 * Every persistent-memory write (session.upsert, skill.observe,
 * skill.promote, skill.decay, pending.insert, pending.resolve,
 * summary.generate) appends a row through the host's
 * `AuditChainPort`. This module is a thin convenience helper +
 * reference in-memory implementation for tests; production wires a
 * Postgres-backed port that delegates to `@borjie/audit-hash-chain`.
 *
 * Why a port instead of a hard dependency? Same reasoning as the
 * cognitive-memory package (Wave 18AA):
 *   1. The hash-chain primitive is pure — persistence is host-owned.
 *   2. Different host contexts persist differently (API, worker,
 *      tests).
 *   3. Decoupling keeps this package free of database adapters.
 */

import type { AuditChainPort } from '../types.js';

/**
 * Reference in-memory chain — useful for tests and ephemeral worker
 * contexts that do not require durable provenance. Production wiring
 * replaces this with a Postgres-backed implementation that delegates
 * to `@borjie/audit-hash-chain`.
 */
export function createInMemoryAuditChain(): AuditChainPort & {
  readonly history: () => ReadonlyArray<Readonly<Record<string, unknown>>>;
} {
  const rows: Array<Readonly<Record<string, unknown>>> = [];

  return {
    async append(payload) {
      const row = {
        ...payload,
        chain_index: rows.length,
        row_hash: `pm-chain-${rows.length.toString(16).padStart(8, '0')}`,
      };
      rows.push(row);
      return row.row_hash;
    },
    history() {
      return rows.slice();
    },
  };
}

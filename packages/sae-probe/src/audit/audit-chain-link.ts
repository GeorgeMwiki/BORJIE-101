/**
 * Audit-chain link helper (Wave 18BB-gap).
 *
 * Every persisted SAE firing appends a row through the host's
 * `AuditChainPort`. This module is a thin reference in-memory
 * implementation for tests; production wires a Postgres-backed port
 * that delegates to `@borjie/audit-hash-chain`.
 */

import type { AuditChainPort } from '../types.js';

export interface InMemoryAuditChain extends AuditChainPort {
  readonly history: () => ReadonlyArray<Readonly<Record<string, unknown>>>;
}

export function createInMemoryAuditChain(): InMemoryAuditChain {
  const rows: Array<Readonly<Record<string, unknown>>> = [];

  return {
    async append(payload) {
      const row = {
        ...payload,
        chain_index: rows.length,
        row_hash: `sae-chain-${rows.length.toString(16).padStart(8, '0')}`,
      };
      rows.push(row);
      return row.row_hash;
    },
    history() {
      return rows.slice();
    },
  };
}

/**
 * Audit-chain link helper (Wave 18BB-gap).
 *
 * Every calibration-monitor write (observation.insert,
 * observation.resolve, report.emit) appends a row through the
 * host's `AuditChainPort`. This module is a thin reference
 * in-memory implementation for tests; production wires a
 * Postgres-backed port that delegates to `@borjie/audit-hash-chain`.
 *
 * Why a port instead of a hard dependency? Same reasoning as the
 * persistent-memory + cognitive-memory packages: the hash-chain
 * primitive is pure; persistence is host-owned; different host
 * contexts persist differently.
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
        row_hash: `cm-chain-${rows.length.toString(16).padStart(8, '0')}`,
      };
      rows.push(row);
      return row.row_hash;
    },
    history() {
      return rows.slice();
    },
  };
}

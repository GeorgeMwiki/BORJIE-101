/**
 * In-memory reference `AuditChainPort` (matches the pattern in
 * `@borjie/persistent-memory`). Production wires the Postgres
 * `@borjie/audit-hash-chain` implementation.
 */

import type { AuditChainPort } from '../types.js';

export function createInMemoryAuditChain(): AuditChainPort & {
  readonly history: () => ReadonlyArray<Readonly<Record<string, unknown>>>;
} {
  const rows: Array<Readonly<Record<string, unknown>>> = [];

  return {
    async append(payload) {
      const row = {
        ...payload,
        chain_index: rows.length,
        row_hash: `followup-chain-${rows.length.toString(16).padStart(8, '0')}`,
      };
      rows.push(row);
      return row.row_hash as string;
    },
    history() {
      return rows.slice();
    },
  };
}

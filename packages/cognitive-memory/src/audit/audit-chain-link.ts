/**
 * Audit-chain link helper (Wave 18AA).
 *
 * Every memory mutation (observe / reinforce / cite / contradict /
 * promote / decay) appends a row to the tenant audit chain via
 * `@borjie/audit-hash-chain`. This module is a thin convenience layer
 * over the `AuditChainPort` declared in `types.ts` — it does NOT take
 * a hard dependency on the durable chain store. The host wires in
 * persistence (Postgres, Supabase, whatever) when constructing the
 * port.
 *
 * Why a port and not a direct dependency on `@borjie/audit-hash-chain`?
 *   1. `@borjie/audit-hash-chain` is pure — it does not persist. The
 *      caller is responsible for writing chain entries somewhere.
 *   2. Different host contexts wire persistence differently (the API
 *      app writes to Postgres; the consolidation worker writes to a
 *      service-role table; tests use an in-memory chain).
 *   3. Decoupling lets the cognitive-memory package stay free of
 *      database adapters.
 */

import type { AuditChainPort } from '../types.js';

/**
 * Reference in-memory chain — useful for tests and for one-shot
 * service-worker contexts that don't need durability. Production
 * wiring replaces this with a Postgres-backed implementation.
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
        // For the in-memory variant we hash a deterministic prefix +
        // index. The Postgres impl will use the full sha256 + secret
        // rotation primitive from @borjie/audit-hash-chain.
        row_hash: `memory-chain-${rows.length.toString(16).padStart(8, '0')}`,
      };
      rows.push(row);
      return row.row_hash;
    },
    history() {
      return rows.slice();
    },
  };
}

/**
 * Convenience wrapper — appends an audit row and returns the row hash.
 * Exists so call sites read more naturally:
 *
 *   const audit_hash = await appendMemoryAudit(chain, { ... });
 */
export async function appendMemoryAudit(
  chain: AuditChainPort,
  payload: Parameters<AuditChainPort['append']>[0],
): Promise<string> {
  return chain.append(payload);
}

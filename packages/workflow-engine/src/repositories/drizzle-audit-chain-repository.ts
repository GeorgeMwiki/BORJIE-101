/**
 * Drizzle-backed `AuditChainRepository`.
 *
 * Persists the hashed, per-tenant append-only chain to
 * `workflow_audit_chain` (migration 0307) so the "append-only" audit
 * trail SURVIVES an api-gateway restart — closing the false SOC 2 CC7.2
 * claim flagged in the execution audit (EX-10).
 *
 *   - `insert` carries `entry.tenantId` → tenant-context transaction.
 *     The unique index on (tenant_id, current_hash) is a defence-in-depth
 *     guard against a duplicated head being silently accepted.
 *   - `latestHashForTenant` returns the most-recent `current_hash` for
 *     the tenant (the chain head used as the next `previous_hash`), or
 *     the documented seed `'GENESIS'` when the tenant has no entries yet.
 *   - `listForRun` reads under the service-role bypass (no tenant arg;
 *     run id globally unique) and orders by `recorded_at` so
 *     verifyChainForRun walks the chain in append order.
 *
 * Linearity note: the engine serializes transitions per run via its
 * per-run mutex, and a single audit append happens inside each
 * transition. Appends from concurrent runs of the SAME tenant order by
 * `recorded_at`; the unique (tenant_id, current_hash) index rejects an
 * accidental duplicate head.
 */

import { desc, eq } from 'drizzle-orm';
import {
  workflowAuditChain,
  withTenantContext,
  withServiceRoleContext,
  type DatabaseClient,
} from '@borjie/database';
import type {
  AuditChainEntry,
  AuditChainRepository,
} from '../types.js';
import { rowToAuditEntry } from './row-mappers.js';

/** Documented chain seed — the head before a tenant's first entry. */
const GENESIS = 'GENESIS';

export function createDrizzleAuditChainRepository(
  db: DatabaseClient | null,
): AuditChainRepository {
  if (!db) {
    throw new Error(
      'createDrizzleAuditChainRepository requires a DatabaseClient (got null)',
    );
  }
  return {
    async insert(entry: AuditChainEntry) {
      await withTenantContext(db, entry.tenantId, async (tx) => {
        await tx.insert(workflowAuditChain).values({
          id: entry.id,
          runId: entry.runId,
          tenantId: entry.tenantId,
          previousHash: entry.previousHash,
          currentHash: entry.currentHash,
          recordedKind: entry.recordedKind,
          recordedPayload: { ...entry.recordedPayload },
          recordedAt: entry.recordedAt,
        });
      });
    },

    async listForRun(runId) {
      const rows = await withServiceRoleContext(db, async (tx) => {
        return tx
          .select()
          .from(workflowAuditChain)
          .where(eq(workflowAuditChain.runId, runId))
          .orderBy(workflowAuditChain.recordedAt);
      });
      return Object.freeze(
        (rows as Record<string, unknown>[]).map(rowToAuditEntry),
      );
    },

    async latestHashForTenant(tenantId) {
      const rows = await withTenantContext(db, tenantId, async (tx) => {
        return tx
          .select({ currentHash: workflowAuditChain.currentHash })
          .from(workflowAuditChain)
          .where(eq(workflowAuditChain.tenantId, tenantId))
          .orderBy(desc(workflowAuditChain.recordedAt))
          .limit(1);
      });
      const row = (rows as { currentHash: string }[])[0];
      return row ? row.currentHash : GENESIS;
    },
  };
}

/**
 * Drizzle-backed `AuditChainRepository` adapter — A2b-2 wire #8.
 *
 * Bridges the ai-copilot `AuditChainRepository` port onto the
 * `ai_audit_chain` Postgres table (schema:
 * `packages/database/src/schemas/ai-audit-chain.schema.ts`, migration
 * 0127). Replaces the prior `verifier: null` literal that left the
 * audit-verify cron supervisor inert in degraded mode.
 *
 * Read paths used by the verifier:
 *   - `insertEntry(...)`     — append a new row (HMAC-pinned hash chain)
 *   - `getLatest(tenantId)`  — most recent row for chaining
 *   - `listByTenant(tenantId, {fromSeq, limit})` — paginated walk
 *   - `streamByTenant(...)`  — OOM-safe streaming for verifyChain
 *
 * Tenant isolation:
 *   - Every query carries `WHERE tenant_id = $1` so a tampered tenant
 *     scope cannot cross-leak rows. RLS is the second belt-and-braces
 *     layer once the broader 0156 migration lands.
 */

import { sql } from 'drizzle-orm';
import type {
  AuditChainRepository,
  HashedAuditEntry,
} from '@borjie/ai-copilot';

interface DrizzleLikeClient {
  execute(q: unknown): Promise<unknown>;
}

interface AuditChainRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly sequence_id: string | number;
  readonly turn_id: string;
  readonly session_id: string | null;
  readonly action: string;
  readonly prev_hash: string;
  readonly this_hash: string;
  readonly payload_ref: string | null;
  readonly payload: unknown;
  readonly created_at: Date | string;
}

function toEntry(row: AuditChainRow): HashedAuditEntry {
  const seq =
    typeof row.sequence_id === 'number'
      ? row.sequence_id
      : Number.parseInt(row.sequence_id, 10);
  const createdAt =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString();
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sequenceId: seq,
    turnId: row.turn_id,
    sessionId: row.session_id,
    action: row.action,
    prevHash: row.prev_hash,
    thisHash: row.this_hash,
    payloadRef: row.payload_ref,
    payload: (row.payload as Readonly<Record<string, unknown>>) ?? {},
    createdAt,
  };
}

function rowsOf(result: unknown): ReadonlyArray<AuditChainRow> {
  if (Array.isArray(result)) return result as ReadonlyArray<AuditChainRow>;
  const rows = (result as { rows?: unknown }).rows;
  if (Array.isArray(rows)) return rows as ReadonlyArray<AuditChainRow>;
  return [];
}

/**
 * Build the Drizzle-backed repository. Returns null when `db` is
 * missing so the composition root can fall back to degraded mode.
 */
export function createDrizzleAiAuditChainRepo(
  db: DrizzleLikeClient | null | undefined,
): AuditChainRepository | null {
  if (!db) return null;

  return {
    async insertEntry(entry) {
      await db.execute(
        sql`
          INSERT INTO ai_audit_chain (
            id, tenant_id, sequence_id, turn_id, session_id, action,
            prev_hash, this_hash, payload_ref, payload, created_at
          ) VALUES (
            ${entry.id},
            ${entry.tenantId},
            ${entry.sequenceId},
            ${entry.turnId},
            ${entry.sessionId},
            ${entry.action},
            ${entry.prevHash},
            ${entry.thisHash},
            ${entry.payloadRef},
            ${JSON.stringify(entry.payload ?? {})}::jsonb,
            ${entry.createdAt}
          )
        `,
      );
      return entry;
    },

    async getLatest(tenantId) {
      const result = await db.execute(
        sql`
          SELECT id, tenant_id, sequence_id, turn_id, session_id, action,
                 prev_hash, this_hash, payload_ref, payload, created_at
          FROM ai_audit_chain
          WHERE tenant_id = ${tenantId}
          ORDER BY sequence_id DESC
          LIMIT 1
        `,
      );
      const rows = rowsOf(result);
      return rows.length > 0 ? toEntry(rows[0]!) : null;
    },

    async listByTenant(tenantId, options) {
      const fromSeq = options?.fromSeq ?? 0;
      const limit = options?.limit ?? 500;
      const result = await db.execute(
        sql`
          SELECT id, tenant_id, sequence_id, turn_id, session_id, action,
                 prev_hash, this_hash, payload_ref, payload, created_at
          FROM ai_audit_chain
          WHERE tenant_id = ${tenantId}
            AND sequence_id >= ${fromSeq}
          ORDER BY sequence_id ASC
          LIMIT ${limit}
        `,
      );
      return rowsOf(result).map(toEntry);
    },

    async *streamByTenant(tenantId, options) {
      const batchSize = options?.batchSize ?? 500;
      let fromSeq = options?.fromSeq ?? 0;
      while (true) {
        const result = await db.execute(
          sql`
            SELECT id, tenant_id, sequence_id, turn_id, session_id, action,
                   prev_hash, this_hash, payload_ref, payload, created_at
            FROM ai_audit_chain
            WHERE tenant_id = ${tenantId}
              AND sequence_id >= ${fromSeq}
            ORDER BY sequence_id ASC
            LIMIT ${batchSize}
          `,
        );
        const batch = rowsOf(result).map(toEntry);
        if (batch.length === 0) return;
        yield batch;
        if (batch.length < batchSize) return;
        fromSeq = batch[batch.length - 1]!.sequenceId + 1;
      }
    },

    async countByTenant(tenantId) {
      const result = await db.execute(
        sql`SELECT COUNT(*)::bigint AS n FROM ai_audit_chain WHERE tenant_id = ${tenantId}`,
      );
      const rows = rowsOf(result) as ReadonlyArray<{ n?: unknown }>;
      if (rows.length === 0) return 0;
      const n = rows[0]!.n;
      if (typeof n === 'number') return n;
      if (typeof n === 'string') return Number.parseInt(n, 10) || 0;
      return 0;
    },
  };
}

/**
 * Field-level encryption audit service (migration 0143) — Phase D D1.
 *
 * Drizzle-backed implementation of the `FieldEncryptionAuditSink` port
 * defined in `packages/database/src/security/encryption/
 * drizzle-encryption-middleware.ts`. Composition roots wire this
 * service into the middleware so every encrypted write produces an
 * audit row capturing (tenantId, table, column, rowId, keyVersion).
 *
 * Operations:
 *   - `recordEncryptedField(args)` — INSERT one audit row. Idempotent
 *     in spirit (a fresh UUID per call); duplicate writes for the
 *     same logical row are fine — the rotation script reduces by the
 *     latest key_version per (table, row_id).
 *   - `listByScope(args)` — return audit rows for a (tenantId, table,
 *     column) scope; powers the rotation-coverage dashboard.
 *   - `markRotated(ids)` — bulk UPDATE to stamp `rotated_at` after
 *     the rotation script re-encrypts a row.
 *   - `countByKeyVersion(args)` — aggregate count grouped by
 *     key_version; one row per active generation.
 *
 * Side-channel safety: all hard DB failures are LOGGED (NEVER throw)
 * because the audit sink is a fire-and-forget hook on the write path.
 * A failing audit table must not break the primary insert/update.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import {
  fieldEncryptionAudit,
  type FieldEncryptionAuditRow,
} from '../schemas/field-encryption-audit.schema.js';
import { logger } from '../logger.js';
import type { DatabaseClient } from '../client.js';

export interface RecordEncryptedFieldArgs {
  readonly tenantId: string | null;
  readonly table: string;
  readonly column: string;
  readonly rowId: string | null;
  readonly keyVersion: number;
}

export interface ListByScopeArgs {
  readonly tenantId: string | null;
  readonly table: string;
  readonly column: string;
  readonly limit?: number;
}

export interface CountByKeyVersionArgs {
  readonly tenantId?: string | null;
  readonly table: string;
  readonly column: string;
}

export interface KeyVersionCount {
  readonly keyVersion: number;
  readonly count: number;
}

export interface FieldEncryptionAuditEntry {
  readonly id: string;
  readonly tenantId: string | null;
  readonly table: string;
  readonly column: string;
  readonly rowId: string | null;
  readonly keyVersion: number;
  readonly encryptedAt: string;
  readonly rotatedAt: string | null;
}

export interface FieldEncryptionAuditService {
  recordEncryptedField(args: RecordEncryptedFieldArgs): Promise<void>;
  listByScope(
    args: ListByScopeArgs,
  ): Promise<ReadonlyArray<FieldEncryptionAuditEntry>>;
  markRotated(ids: ReadonlyArray<string>): Promise<void>;
  countByKeyVersion(
    args: CountByKeyVersionArgs,
  ): Promise<ReadonlyArray<KeyVersionCount>>;
}

const DEFAULT_LIST_LIMIT = 500;
const MAX_LIST_LIMIT = 5000;

export function createFieldEncryptionAuditService(
  db: DatabaseClient,
): FieldEncryptionAuditService {
  return {
    async recordEncryptedField(args) {
      if (!args || !args.table || !args.column) return;
      if (
        typeof args.keyVersion !== 'number' ||
        !Number.isFinite(args.keyVersion) ||
        args.keyVersion < 1
      ) {
        return;
      }
      try {
        await db.insert(fieldEncryptionAudit).values({
          id: randomUUID(),
          tenantId: args.tenantId ?? null,
          tableName: args.table.toLowerCase().slice(0, 128),
          columnName: args.column.toLowerCase().slice(0, 128),
          rowId: args.rowId ?? null,
          keyVersion: Math.floor(args.keyVersion),
        } as never);
      } catch (error) {
        logger.warn('field-encryption-audit.recordEncryptedField failed', {
          table: args.table,
          column: args.column,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async listByScope(args) {
      try {
        if (!args || !args.table || !args.column) return [];
        const limit = clamp(args.limit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
        const where =
          args.tenantId === null || args.tenantId === undefined
            ? and(
                eq(fieldEncryptionAudit.tableName, args.table.toLowerCase()),
                eq(fieldEncryptionAudit.columnName, args.column.toLowerCase()),
              )
            : and(
                eq(fieldEncryptionAudit.tenantId, args.tenantId),
                eq(fieldEncryptionAudit.tableName, args.table.toLowerCase()),
                eq(fieldEncryptionAudit.columnName, args.column.toLowerCase()),
              );
        const rows = (await db
          .select(SELECT_COLS)
          .from(fieldEncryptionAudit)
          .where(where)
          .orderBy(desc(fieldEncryptionAudit.encryptedAt))
          .limit(limit)) as ReadonlyArray<FieldEncryptionAuditRow>;
        return (rows ?? []).map(rowToEntry);
      } catch (error) {
        logger.warn('field-encryption-audit.listByScope failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    },

    async markRotated(ids) {
      if (!ids || ids.length === 0) return;
      try {
        await db
          .update(fieldEncryptionAudit)
          .set({ rotatedAt: new Date() } as never)
          .where(inArray(fieldEncryptionAudit.id, [...ids]));
      } catch (error) {
        logger.warn('field-encryption-audit.markRotated failed', {
          count: ids.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async countByKeyVersion(args) {
      try {
        if (!args || !args.table || !args.column) return [];
        const where =
          args.tenantId === null || args.tenantId === undefined
            ? and(
                eq(fieldEncryptionAudit.tableName, args.table.toLowerCase()),
                eq(fieldEncryptionAudit.columnName, args.column.toLowerCase()),
              )
            : and(
                eq(fieldEncryptionAudit.tenantId, args.tenantId),
                eq(fieldEncryptionAudit.tableName, args.table.toLowerCase()),
                eq(fieldEncryptionAudit.columnName, args.column.toLowerCase()),
              );
        const rows = (await db
          .select({
            keyVersion: fieldEncryptionAudit.keyVersion,
            count: sql<number>`count(*)::int`,
          })
          .from(fieldEncryptionAudit)
          .where(where)
          .groupBy(fieldEncryptionAudit.keyVersion)) as ReadonlyArray<{
          keyVersion: number;
          count: number | string;
        }>;
        return (rows ?? []).map((r) => ({
          keyVersion: Number(r.keyVersion) || 0,
          count: Number(r.count) || 0,
        }));
      } catch (error) {
        logger.warn('field-encryption-audit.countByKeyVersion failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    },
  };
}

const SELECT_COLS = {
  id: fieldEncryptionAudit.id,
  tenantId: fieldEncryptionAudit.tenantId,
  tableName: fieldEncryptionAudit.tableName,
  columnName: fieldEncryptionAudit.columnName,
  rowId: fieldEncryptionAudit.rowId,
  keyVersion: fieldEncryptionAudit.keyVersion,
  encryptedAt: fieldEncryptionAudit.encryptedAt,
  rotatedAt: fieldEncryptionAudit.rotatedAt,
} as const;

function rowToEntry(row: FieldEncryptionAuditRow): FieldEncryptionAuditEntry {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    table: row.tableName,
    column: row.columnName,
    rowId: row.rowId ?? null,
    keyVersion: Number(row.keyVersion) || 0,
    encryptedAt: toIso(row.encryptedAt),
    rotatedAt: row.rotatedAt ? toIso(row.rotatedAt) : null,
  };
}

function toIso(v: Date | string): string {
  if (v instanceof Date) return v.toISOString();
  return new Date(v).toISOString();
}

function clamp(
  v: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) return fallback;
  return Math.min(max, Math.floor(v));
}

/**
 * SQL HubSpot records repository — Postgres / Drizzle target table
 * `hubspot_records` (migration 0046).
 */

import type { HubSpotRecordRow, HubSpotRecordRepository } from './in-memory.js';

export interface SqlExecutorPort {
  readonly run: <T>(sql: string, params: ReadonlyArray<unknown>) => Promise<T | null>;
  readonly all: <T>(sql: string, params: ReadonlyArray<unknown>) => Promise<ReadonlyArray<T>>;
}

export function createSqlHubSpotRepository(
  executor: SqlExecutorPort,
): HubSpotRecordRepository {
  return {
    async upsert(row) {
      const upserted = await executor.run<HubSpotRecordRow>(
        `INSERT INTO hubspot_records
           (tenant_id, account, object_type, object_id, properties,
            updated_at, raw, audit_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (tenant_id, account, object_type, object_id)
         DO UPDATE SET
           properties = EXCLUDED.properties,
           updated_at = EXCLUDED.updated_at,
           raw = EXCLUDED.raw,
           audit_hash = EXCLUDED.audit_hash
         WHERE hubspot_records.updated_at < EXCLUDED.updated_at
         RETURNING *`,
        [
          row.tenantId,
          row.account,
          row.objectType,
          row.objectId,
          JSON.stringify(row.properties),
          row.updatedAt,
          JSON.stringify(row.raw),
          row.auditHash,
        ],
      );
      return upserted ?? row;
    },
    async findByKey(p) {
      return executor.run<HubSpotRecordRow>(
        `SELECT * FROM hubspot_records
         WHERE tenant_id=$1 AND account=$2 AND object_type=$3 AND object_id=$4 LIMIT 1`,
        [p.tenantId, p.account, p.objectType, p.objectId],
      );
    },
    async all() {
      return executor.all<HubSpotRecordRow>(
        `SELECT * FROM hubspot_records ORDER BY ingested_at DESC`,
        [],
      );
    },
  };
}

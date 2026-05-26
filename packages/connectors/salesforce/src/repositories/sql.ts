/**
 * SQL Salesforce records repository — Postgres / Drizzle.
 *
 * Wired against the `salesforce_records` table (migration 0046).
 * Concrete Drizzle client is injected so this package has no
 * compile-time dependency on `drizzle-orm`. Production composition
 * roots pass the real client.
 */

import type {
  SalesforceRecordRepository,
  SalesforceRecordRow,
} from './in-memory.js';

export interface SqlExecutorPort {
  /**
   * Run an arbitrary parameterised SQL statement. Returns the first
   * row of the RETURNING set (or null when no rows came back).
   */
  readonly run: <T>(sql: string, params: ReadonlyArray<unknown>) => Promise<T | null>;
  readonly all: <T>(sql: string, params: ReadonlyArray<unknown>) => Promise<ReadonlyArray<T>>;
}

export function createSqlSalesforceRepository(
  executor: SqlExecutorPort,
): SalesforceRecordRepository {
  return {
    async upsert(row) {
      const upserted = await executor.run<SalesforceRecordRow>(
        `INSERT INTO salesforce_records
           (tenant_id, account, sobject_type, sobject_id, fields,
            last_modified_date, raw, audit_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (tenant_id, account, sobject_type, sobject_id)
         DO UPDATE SET
           fields = EXCLUDED.fields,
           last_modified_date = EXCLUDED.last_modified_date,
           raw = EXCLUDED.raw,
           audit_hash = EXCLUDED.audit_hash
         WHERE salesforce_records.last_modified_date < EXCLUDED.last_modified_date
         RETURNING *`,
        [
          row.tenantId,
          row.account,
          row.sobjectType,
          row.sobjectId,
          JSON.stringify(row.fields),
          row.lastModifiedDate,
          JSON.stringify(row.raw),
          row.auditHash,
        ],
      );
      return upserted ?? row;
    },
    async findByKey(params) {
      return executor.run<SalesforceRecordRow>(
        `SELECT * FROM salesforce_records
         WHERE tenant_id = $1 AND account = $2
           AND sobject_type = $3 AND sobject_id = $4
         LIMIT 1`,
        [params.tenantId, params.account, params.sobjectType, params.sobjectId],
      );
    },
    async all() {
      return executor.all<SalesforceRecordRow>(
        `SELECT * FROM salesforce_records ORDER BY ingested_at DESC`,
        [],
      );
    },
  };
}

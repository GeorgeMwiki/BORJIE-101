/**
 * SQL GitHub records repository — target `github_records`.
 */

import type { GitHubRecordRepository, GitHubRecordRow } from './in-memory.js';

export interface SqlExecutorPort {
  readonly run: <T>(sql: string, params: ReadonlyArray<unknown>) => Promise<T | null>;
  readonly all: <T>(sql: string, params: ReadonlyArray<unknown>) => Promise<ReadonlyArray<T>>;
}

export function createSqlGitHubRepository(executor: SqlExecutorPort): GitHubRecordRepository {
  return {
    async upsert(row) {
      const upserted = await executor.run<GitHubRecordRow>(
        `INSERT INTO github_records
           (tenant_id, account, entity_kind, entity_id, fields,
            updated_at, raw, audit_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (tenant_id, account, entity_kind, entity_id)
         DO UPDATE SET fields=EXCLUDED.fields, updated_at=EXCLUDED.updated_at,
                       raw=EXCLUDED.raw, audit_hash=EXCLUDED.audit_hash
         WHERE github_records.updated_at < EXCLUDED.updated_at
         RETURNING *`,
        [
          row.tenantId, row.account, row.entityKind, row.entityId,
          JSON.stringify(row.fields), row.updatedAt,
          JSON.stringify(row.raw), row.auditHash,
        ],
      );
      return upserted ?? row;
    },
    async findByKey(p) {
      return executor.run<GitHubRecordRow>(
        `SELECT * FROM github_records WHERE tenant_id=$1 AND account=$2 AND entity_kind=$3 AND entity_id=$4 LIMIT 1`,
        [p.tenantId, p.account, p.entityKind, p.entityId],
      );
    },
    async all() {
      return executor.all<GitHubRecordRow>(`SELECT * FROM github_records ORDER BY ingested_at DESC`, []);
    },
  };
}

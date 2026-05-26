/**
 * Repository for `objective_progress` (in-memory + SQL adapters).
 */

import {
  type ObjectiveProgress,
  type ObjectiveProgressRepository,
} from '../types.js';
import type { SqlRunner } from './sql-runner.js';

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

export function createInMemoryObjectiveProgressRepository(): ObjectiveProgressRepository {
  const rows: ObjectiveProgress[] = [];

  return {
    async insert(row: ObjectiveProgress): Promise<ObjectiveProgress> {
      const frozen = Object.freeze({ ...row });
      rows.push(frozen);
      return frozen;
    },

    async listForObjective(
      tenantId: string,
      objectiveId: string,
      limit: number,
    ): Promise<ReadonlyArray<ObjectiveProgress>> {
      const matches = rows
        .filter(
          (r) => r.tenantId === tenantId && r.objectiveId === objectiveId,
        )
        .sort(
          (a, b) =>
            new Date(b.recordedAt).getTime() -
            new Date(a.recordedAt).getTime(),
        )
        .slice(0, limit);
      return matches;
    },

    async latest(
      tenantId: string,
      objectiveId: string,
    ): Promise<ObjectiveProgress | null> {
      let latest: ObjectiveProgress | null = null;
      for (const row of rows) {
        if (row.tenantId !== tenantId || row.objectiveId !== objectiveId) {
          continue;
        }
        if (
          latest === null ||
          new Date(row.recordedAt).getTime() >
            new Date(latest.recordedAt).getTime()
        ) {
          latest = row;
        }
      }
      return latest;
    },
  };
}

// ---------------------------------------------------------------------------
// SQL adapter
// ---------------------------------------------------------------------------

interface SqlProgressRow {
  readonly id: string;
  readonly objective_id: string;
  readonly tenant_id: string;
  readonly recorded_at: Date | string;
  readonly observed_value: string | number;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly audit_hash: string;
}

export function createSqlObjectiveProgressRepository(
  sql: SqlRunner,
): ObjectiveProgressRepository {
  return {
    async insert(row: ObjectiveProgress): Promise<ObjectiveProgress> {
      await sql.query(
        `INSERT INTO objective_progress
           (id, objective_id, tenant_id, recorded_at, observed_value,
            evidence, audit_hash)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          row.id,
          row.objectiveId,
          row.tenantId,
          row.recordedAt,
          row.observedValue,
          JSON.stringify(row.evidence),
          row.auditHash,
        ],
      );
      return row;
    },

    async listForObjective(
      tenantId: string,
      objectiveId: string,
      limit: number,
    ): Promise<ReadonlyArray<ObjectiveProgress>> {
      const result = await sql.query<SqlProgressRow>(
        `SELECT * FROM objective_progress
          WHERE tenant_id = $1 AND objective_id = $2
          ORDER BY recorded_at DESC
          LIMIT $3`,
        [tenantId, objectiveId, limit],
      );
      return result.rows.map(mapSqlRow);
    },

    async latest(
      tenantId: string,
      objectiveId: string,
    ): Promise<ObjectiveProgress | null> {
      const result = await sql.query<SqlProgressRow>(
        `SELECT * FROM objective_progress
          WHERE tenant_id = $1 AND objective_id = $2
          ORDER BY recorded_at DESC
          LIMIT 1`,
        [tenantId, objectiveId],
      );
      const first = result.rows[0];
      return first === undefined ? null : mapSqlRow(first);
    },
  };
}

function mapSqlRow(row: SqlProgressRow): ObjectiveProgress {
  return Object.freeze({
    id: row.id,
    objectiveId: row.objective_id,
    tenantId: row.tenant_id,
    recordedAt: typeof row.recorded_at === 'string'
      ? row.recorded_at
      : row.recorded_at.toISOString(),
    observedValue: Number(row.observed_value),
    evidence: row.evidence,
    auditHash: row.audit_hash,
  });
}

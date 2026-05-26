/**
 * Repository for `north_star_objectives` (in-memory + SQL adapters).
 *
 * Production wires the SQL adapter against a `pg.Pool`-shaped client.
 * Tests + the in-memory dev fixture use the in-memory adapter.
 */

import {
  type NorthStar,
  type NorthStarObjectivesRepository,
  type ObjectiveStatus,
} from '../types.js';
import type { SqlRunner } from './sql-runner.js';

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

export function createInMemoryNorthStarObjectivesRepository(): NorthStarObjectivesRepository {
  const rows = new Map<string, NorthStar>();

  return {
    async insert(row: NorthStar): Promise<NorthStar> {
      const frozen = Object.freeze({ ...row });
      rows.set(frozen.id, frozen);
      return frozen;
    },

    async findById(tenantId: string, id: string): Promise<NorthStar | null> {
      const row = rows.get(id);
      if (row === undefined || row.tenantId !== tenantId) {
        return null;
      }
      return row;
    },

    async updateStatus(
      tenantId: string,
      id: string,
      status: ObjectiveStatus,
      updatedAt: string,
      auditHash: string,
      prevHash: string,
    ): Promise<NorthStar> {
      const existing = rows.get(id);
      if (existing === undefined || existing.tenantId !== tenantId) {
        throw new Error(`Objective not found: tenant=${tenantId} id=${id}`);
      }
      const updated: NorthStar = Object.freeze({
        ...existing,
        status,
        updatedAt,
        auditHash,
        prevHash,
      });
      rows.set(id, updated);
      return updated;
    },

    async listActive(
      tenantId: string,
    ): Promise<ReadonlyArray<NorthStar>> {
      const out: NorthStar[] = [];
      for (const row of rows.values()) {
        if (row.tenantId === tenantId && row.status === 'active') {
          out.push(row);
        }
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// SQL adapter — postgres parameterised queries
// ---------------------------------------------------------------------------

interface SqlNorthStarRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly scope_id: string;
  readonly title: string;
  readonly description: string;
  readonly metric_name: string;
  readonly target_value: string | number;
  readonly target_at: Date | string;
  readonly status: string;
  readonly owner_user_id: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly audit_hash: string;
  readonly prev_hash: string | null;
}

export function createSqlNorthStarObjectivesRepository(
  sql: SqlRunner,
): NorthStarObjectivesRepository {
  return {
    async insert(row: NorthStar): Promise<NorthStar> {
      await sql.query(
        `INSERT INTO north_star_objectives
           (id, tenant_id, scope_id, title, description, metric_name,
            target_value, target_at, status, owner_user_id,
            created_at, updated_at, audit_hash, prev_hash)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          row.id,
          row.tenantId,
          row.scopeId,
          row.title,
          row.description,
          row.metricName,
          row.targetValue,
          row.targetAt,
          row.status,
          row.ownerUserId,
          row.createdAt,
          row.updatedAt,
          row.auditHash,
          row.prevHash,
        ],
      );
      return row;
    },

    async findById(tenantId: string, id: string): Promise<NorthStar | null> {
      const result = await sql.query<SqlNorthStarRow>(
        `SELECT * FROM north_star_objectives
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const first = result.rows[0];
      return first === undefined ? null : mapSqlRow(first);
    },

    async updateStatus(
      tenantId: string,
      id: string,
      status: ObjectiveStatus,
      updatedAt: string,
      auditHash: string,
      prevHash: string,
    ): Promise<NorthStar> {
      const result = await sql.query<SqlNorthStarRow>(
        `UPDATE north_star_objectives
            SET status = $3,
                updated_at = $4,
                audit_hash = $5,
                prev_hash = $6
          WHERE tenant_id = $1 AND id = $2
          RETURNING *`,
        [tenantId, id, status, updatedAt, auditHash, prevHash],
      );
      const first = result.rows[0];
      if (first === undefined) {
        throw new Error(
          `Objective not found for updateStatus: tenant=${tenantId} id=${id}`,
        );
      }
      return mapSqlRow(first);
    },

    async listActive(
      tenantId: string,
    ): Promise<ReadonlyArray<NorthStar>> {
      const result = await sql.query<SqlNorthStarRow>(
        `SELECT * FROM north_star_objectives
          WHERE tenant_id = $1 AND status = 'active'
          ORDER BY target_at ASC`,
        [tenantId],
      );
      return result.rows.map(mapSqlRow);
    },
  };
}

function mapSqlRow(row: SqlNorthStarRow): NorthStar {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    scopeId: row.scope_id,
    title: row.title,
    description: row.description,
    metricName: row.metric_name,
    targetValue: Number(row.target_value),
    targetAt: typeof row.target_at === 'string'
      ? row.target_at
      : row.target_at.toISOString(),
    status: row.status as ObjectiveStatus,
    ownerUserId: row.owner_user_id,
    createdAt: typeof row.created_at === 'string'
      ? row.created_at
      : row.created_at.toISOString(),
    updatedAt: typeof row.updated_at === 'string'
      ? row.updated_at
      : row.updated_at.toISOString(),
    auditHash: row.audit_hash,
    prevHash: row.prev_hash,
  });
}

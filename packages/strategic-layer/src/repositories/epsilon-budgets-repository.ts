/**
 * Repository for `epsilon_budgets` (in-memory + SQL adapters).
 *
 * PK is composite `(tenant_id, period_start)`. `applyCharge` increments
 * `spent_epsilon` and stamps a new `audit_hash`.
 */

import {
  type EpsilonBudget,
  type EpsilonBudgetsRepository,
} from '../types.js';
import type { SqlRunner } from './sql-runner.js';

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

export function createInMemoryEpsilonBudgetsRepository(): EpsilonBudgetsRepository {
  const rows = new Map<string, EpsilonBudget>();

  const key = (tenantId: string, periodStart: string): string =>
    `${tenantId}::${periodStart}`;

  return {
    async insert(row: EpsilonBudget): Promise<EpsilonBudget> {
      const frozen = Object.freeze({ ...row });
      rows.set(key(frozen.tenantId, frozen.periodStart), frozen);
      return frozen;
    },

    async find(
      tenantId: string,
      periodStart: string,
    ): Promise<EpsilonBudget | null> {
      return rows.get(key(tenantId, periodStart)) ?? null;
    },

    async applyCharge(
      tenantId: string,
      periodStart: string,
      delta: number,
      updatedAt: string,
      auditHash: string,
    ): Promise<EpsilonBudget> {
      const existing = rows.get(key(tenantId, periodStart));
      if (existing === undefined) {
        throw new Error(
          `Budget not found for applyCharge: tenant=${tenantId} period=${periodStart}`,
        );
      }
      const updated: EpsilonBudget = Object.freeze({
        ...existing,
        spentEpsilon: existing.spentEpsilon + delta,
        updatedAt,
        auditHash,
      });
      rows.set(key(tenantId, periodStart), updated);
      return updated;
    },
  };
}

// ---------------------------------------------------------------------------
// SQL adapter
// ---------------------------------------------------------------------------

interface SqlBudgetRow {
  readonly tenant_id: string;
  readonly period_start: Date | string;
  readonly total_epsilon: string | number;
  readonly spent_epsilon: string | number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly audit_hash: string;
}

export function createSqlEpsilonBudgetsRepository(
  sql: SqlRunner,
): EpsilonBudgetsRepository {
  return {
    async insert(row: EpsilonBudget): Promise<EpsilonBudget> {
      await sql.query(
        `INSERT INTO epsilon_budgets
           (tenant_id, period_start, total_epsilon, spent_epsilon,
            created_at, updated_at, audit_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          row.tenantId,
          row.periodStart,
          row.totalEpsilon,
          row.spentEpsilon,
          row.createdAt,
          row.updatedAt,
          row.auditHash,
        ],
      );
      return row;
    },

    async find(
      tenantId: string,
      periodStart: string,
    ): Promise<EpsilonBudget | null> {
      const result = await sql.query<SqlBudgetRow>(
        `SELECT * FROM epsilon_budgets
          WHERE tenant_id = $1 AND period_start = $2`,
        [tenantId, periodStart],
      );
      const first = result.rows[0];
      return first === undefined ? null : mapSqlRow(first);
    },

    async applyCharge(
      tenantId: string,
      periodStart: string,
      delta: number,
      updatedAt: string,
      auditHash: string,
    ): Promise<EpsilonBudget> {
      const result = await sql.query<SqlBudgetRow>(
        `UPDATE epsilon_budgets
            SET spent_epsilon = spent_epsilon + $3,
                updated_at    = $4,
                audit_hash    = $5
          WHERE tenant_id = $1 AND period_start = $2
          RETURNING *`,
        [tenantId, periodStart, delta, updatedAt, auditHash],
      );
      const first = result.rows[0];
      if (first === undefined) {
        throw new Error(
          `Budget not found for applyCharge: tenant=${tenantId} period=${periodStart}`,
        );
      }
      return mapSqlRow(first);
    },
  };
}

function mapSqlRow(row: SqlBudgetRow): EpsilonBudget {
  return Object.freeze({
    tenantId: row.tenant_id,
    periodStart: typeof row.period_start === 'string'
      ? row.period_start.slice(0, 10)
      : row.period_start.toISOString().slice(0, 10),
    totalEpsilon: Number(row.total_epsilon),
    spentEpsilon: Number(row.spent_epsilon),
    createdAt: typeof row.created_at === 'string'
      ? row.created_at
      : row.created_at.toISOString(),
    updatedAt: typeof row.updated_at === 'string'
      ? row.updated_at
      : row.updated_at.toISOString(),
    auditHash: row.audit_hash,
  });
}

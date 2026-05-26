/**
 * Repository for `epsilon_ledger` (in-memory + SQL adapters).
 *
 * UNIQUE on `(tenant_id, op_kind, op_id)` enforces idempotency at
 * the database level. The in-memory adapter matches the constraint.
 */

import {
  type EpsilonLedgerEntry,
  type EpsilonLedgerRepository,
} from '../types.js';
import type { SqlRunner } from './sql-runner.js';

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

export function createInMemoryEpsilonLedgerRepository(): EpsilonLedgerRepository {
  const rows: EpsilonLedgerEntry[] = [];

  const idemKey = (
    tenantId: string,
    opKind: string,
    opId: string,
  ): string => `${tenantId}::${opKind}::${opId}`;

  const byIdem = new Map<string, EpsilonLedgerEntry>();

  return {
    async insert(row: EpsilonLedgerEntry): Promise<EpsilonLedgerEntry> {
      const key = idemKey(row.tenantId, row.opKind, row.opId);
      const existing = byIdem.get(key);
      if (existing !== undefined) {
        throw new Error(
          `Idempotency violation: tenant=${row.tenantId} kind=${row.opKind} id=${row.opId}`,
        );
      }
      const frozen = Object.freeze({ ...row });
      rows.push(frozen);
      byIdem.set(key, frozen);
      return frozen;
    },

    async findByIdempotencyKey(
      tenantId: string,
      opKind: string,
      opId: string,
    ): Promise<EpsilonLedgerEntry | null> {
      return byIdem.get(idemKey(tenantId, opKind, opId)) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// SQL adapter
// ---------------------------------------------------------------------------

interface SqlLedgerRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly period_start: Date | string;
  readonly charge_epsilon: string | number;
  readonly op_kind: string;
  readonly op_id: string;
  readonly recorded_at: Date | string;
  readonly audit_hash: string;
}

export function createSqlEpsilonLedgerRepository(
  sql: SqlRunner,
): EpsilonLedgerRepository {
  return {
    async insert(row: EpsilonLedgerEntry): Promise<EpsilonLedgerEntry> {
      await sql.query(
        `INSERT INTO epsilon_ledger
           (id, tenant_id, period_start, charge_epsilon, op_kind, op_id,
            recorded_at, audit_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          row.id,
          row.tenantId,
          row.periodStart,
          row.chargeEpsilon,
          row.opKind,
          row.opId,
          row.recordedAt,
          row.auditHash,
        ],
      );
      return row;
    },

    async findByIdempotencyKey(
      tenantId: string,
      opKind: string,
      opId: string,
    ): Promise<EpsilonLedgerEntry | null> {
      const result = await sql.query<SqlLedgerRow>(
        `SELECT * FROM epsilon_ledger
          WHERE tenant_id = $1 AND op_kind = $2 AND op_id = $3`,
        [tenantId, opKind, opId],
      );
      const first = result.rows[0];
      return first === undefined ? null : mapSqlRow(first);
    },
  };
}

function mapSqlRow(row: SqlLedgerRow): EpsilonLedgerEntry {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    periodStart: typeof row.period_start === 'string'
      ? row.period_start.slice(0, 10)
      : row.period_start.toISOString().slice(0, 10),
    chargeEpsilon: Number(row.charge_epsilon),
    opKind: row.op_kind,
    opId: row.op_id,
    recordedAt: typeof row.recorded_at === 'string'
      ? row.recorded_at
      : row.recorded_at.toISOString(),
    auditHash: row.audit_hash,
  });
}

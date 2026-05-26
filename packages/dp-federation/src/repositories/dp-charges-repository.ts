/**
 * Repositories for `dp_charges`.
 *
 *   - in-memory implementation — backs tests + dev.
 *   - SQL implementation — thin port; production composes onto
 *     Drizzle in @borjie/database.
 *
 * Both honour UNIQUE on (tenant_id, op_id) — duplicate inserts are
 * treated as no-ops (the existing row is returned to the caller via
 * `findById`).
 */

import type {
  DpCharge,
  DpChargesRepository,
} from '../types.js';

// ---------------------------------------------------------------------------
// In-memory
// ---------------------------------------------------------------------------

export function createInMemoryDpChargesRepository(): DpChargesRepository {
  const rows = new Map<string, DpCharge>();

  return Object.freeze({
    async insert(charge: DpCharge): Promise<void> {
      const key = `${charge.tenantId}::${charge.opId}`;
      if (rows.has(key)) {
        // Idempotent: silent no-op on duplicate (op_id is the
        // uniqueness key in the SQL schema).
        return;
      }
      rows.set(key, charge);
    },

    async sumForPeriod(
      tenantId: string,
      periodStart: string,
    ): Promise<number> {
      let total = 0;
      for (const row of rows.values()) {
        if (row.tenantId !== tenantId) continue;
        if (row.periodStart !== periodStart) continue;
        total += row.epsilonDelta;
      }
      return total;
    },

    async findById(
      tenantId: string,
      id: string,
    ): Promise<DpCharge | null> {
      // The "id" here is the op_id per the unique-index semantics.
      const key = `${tenantId}::${id}`;
      return rows.get(key) ?? null;
    },

    async listForPeriod(
      tenantId: string,
      periodStart: string,
    ): Promise<ReadonlyArray<DpCharge>> {
      const out: DpCharge[] = [];
      for (const row of rows.values()) {
        if (row.tenantId !== tenantId) continue;
        if (row.periodStart !== periodStart) continue;
        out.push(row);
      }
      out.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
      return Object.freeze(out);
    },
  });
}

// ---------------------------------------------------------------------------
// SQL (port; production wires onto Drizzle)
// ---------------------------------------------------------------------------

export interface SqlChargesPort {
  readonly executeWithTenant: <T>(
    tenantId: string,
    fn: () => Promise<T>,
  ) => Promise<T>;
  readonly insertRow: (row: DpChargeRow) => Promise<void>;
  readonly sumEpsilon: (
    tenantId: string,
    periodStart: string,
  ) => Promise<number>;
  readonly fetchByOpId: (
    tenantId: string,
    opId: string,
  ) => Promise<DpChargeRow | null>;
  readonly fetchForPeriod: (
    tenantId: string,
    periodStart: string,
  ) => Promise<ReadonlyArray<DpChargeRow>>;
}

export interface DpChargeRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly period_start: string;
  readonly epsilon_delta: number;
  readonly operation: string;
  readonly op_id: string;
  readonly recorded_at: string;
  readonly audit_hash: string;
}

export function createSqlDpChargesRepository(
  client: SqlChargesPort,
): DpChargesRepository {
  return Object.freeze({
    async insert(charge: DpCharge): Promise<void> {
      return client.executeWithTenant(charge.tenantId, async () => {
        await client.insertRow({
          id: charge.id,
          tenant_id: charge.tenantId,
          period_start: charge.periodStart,
          epsilon_delta: charge.epsilonDelta,
          operation: charge.operation,
          op_id: charge.opId,
          recorded_at: charge.recordedAt,
          audit_hash: charge.auditHash,
        });
      });
    },

    async sumForPeriod(
      tenantId: string,
      periodStart: string,
    ): Promise<number> {
      return client.executeWithTenant(tenantId, () =>
        client.sumEpsilon(tenantId, periodStart),
      );
    },

    async findById(
      tenantId: string,
      id: string,
    ): Promise<DpCharge | null> {
      return client.executeWithTenant(tenantId, async () => {
        const row = await client.fetchByOpId(tenantId, id);
        if (!row) return null;
        return mapRow(row);
      });
    },

    async listForPeriod(
      tenantId: string,
      periodStart: string,
    ): Promise<ReadonlyArray<DpCharge>> {
      return client.executeWithTenant(tenantId, async () => {
        const rows = await client.fetchForPeriod(tenantId, periodStart);
        return rows.map(mapRow);
      });
    },
  });
}

function mapRow(row: DpChargeRow): DpCharge {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    periodStart: row.period_start,
    epsilonDelta: row.epsilon_delta,
    operation: row.operation,
    opId: row.op_id,
    recordedAt: row.recorded_at,
    auditHash: row.audit_hash,
  });
}

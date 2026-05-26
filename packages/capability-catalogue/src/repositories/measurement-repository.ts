/**
 * Measurement repository — port + in-memory + SQL adapters.
 *
 * The worker writes `capability_measurements` rows on every tick. The
 * lifecycle manager reads the most-recent measurement per (capability,
 * window) to decide on transitions.
 *
 * @module @borjie/capability-catalogue/repositories/measurement-repository
 */

import type { Measurement, MeasurementWindowDays } from '../types.js';

export interface MeasurementRepository {
  insert(row: Measurement): Promise<void>;
  /** Latest measurement per (tenantId, capabilityId, windowDays). */
  latestForCapability(args: {
    readonly tenantId: string;
    readonly capabilityId: string;
    readonly windowDays: MeasurementWindowDays;
  }): Promise<Measurement | null>;
  /** All measurements for a tenant — useful for dashboards. */
  listForTenant(tenantId: string): Promise<ReadonlyArray<Measurement>>;
}

export function createInMemoryMeasurementRepository(): MeasurementRepository {
  const rows: Array<Measurement> = [];

  return {
    async insert(row) {
      rows.push(Object.freeze({ ...row }));
    },
    async latestForCapability({ tenantId, capabilityId, windowDays }) {
      let best: Measurement | null = null;
      for (const r of rows) {
        if (
          r.tenantId === tenantId &&
          r.capabilityId === capabilityId &&
          r.windowDays === windowDays
        ) {
          if (best === null || r.measuredAt > best.measuredAt) {
            best = r;
          }
        }
      }
      return best;
    },
    async listForTenant(tenantId) {
      const out: Array<Measurement> = [];
      for (const r of rows) {
        if (r.tenantId === tenantId) out.push(r);
      }
      return Object.freeze(out);
    },
  };
}

export interface SqlMeasurementDriver {
  query(args: {
    readonly text: string;
    readonly values: ReadonlyArray<unknown>;
  }): Promise<ReadonlyArray<Record<string, unknown>>>;
}

function rowToMeasurement(r: Record<string, unknown>): Measurement {
  const ts = r['measured_at'];
  const wd = Number(r['window_days']);
  if (wd !== 7 && wd !== 28 && wd !== 91) {
    throw new Error(`unexpected window_days value: ${wd}`);
  }
  return Object.freeze({
    id: r['id'] as string,
    tenantId: r['tenant_id'] as string,
    capabilityId: r['capability_id'] as string,
    windowDays: wd as MeasurementWindowDays,
    measuredAt: ts instanceof Date ? ts.toISOString() : (ts as string),
    competenceRate: Number(r['competence_rate'] ?? 0),
    calibrationError: Number(r['calibration_error'] ?? 0),
    utilityRate: Number(r['utility_rate'] ?? 0),
    nObservations: Number(r['n_observations'] ?? 0),
    auditHash: r['audit_hash'] as string,
  });
}

export function createSqlMeasurementRepository(args: {
  readonly driver: SqlMeasurementDriver;
}): MeasurementRepository {
  return {
    async insert(row) {
      await args.driver.query({
        text: `
          INSERT INTO capability_measurements
            (id, tenant_id, capability_id, window_days, measured_at,
             competence_rate, calibration_error, utility_rate,
             n_observations, audit_hash)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        values: [
          row.id,
          row.tenantId,
          row.capabilityId,
          row.windowDays,
          row.measuredAt,
          row.competenceRate,
          row.calibrationError,
          row.utilityRate,
          row.nObservations,
          row.auditHash,
        ],
      });
    },
    async latestForCapability({ tenantId, capabilityId, windowDays }) {
      const rows = await args.driver.query({
        text: `
          SELECT id, tenant_id, capability_id, window_days, measured_at,
                 competence_rate, calibration_error, utility_rate,
                 n_observations, audit_hash
            FROM capability_measurements
           WHERE tenant_id = $1
             AND capability_id = $2
             AND window_days = $3
           ORDER BY measured_at DESC
           LIMIT 1
        `,
        values: [tenantId, capabilityId, windowDays],
      });
      const row = rows[0];
      return row ? rowToMeasurement(row) : null;
    },
    async listForTenant(tenantId) {
      const rows = await args.driver.query({
        text: `
          SELECT id, tenant_id, capability_id, window_days, measured_at,
                 competence_rate, calibration_error, utility_rate,
                 n_observations, audit_hash
            FROM capability_measurements
           WHERE tenant_id = $1
           ORDER BY measured_at DESC
        `,
        values: [tenantId],
      });
      return Object.freeze(rows.map(rowToMeasurement));
    },
  };
}

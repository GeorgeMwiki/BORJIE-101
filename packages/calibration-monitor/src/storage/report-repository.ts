/**
 * In-memory reference implementation of `ReportRepository`
 * (Wave 18BB-gap). Production wires a Postgres-backed adapter using
 * the Drizzle schema in `@borjie/database`.
 */

import type { CalibrationReport, ReportRepository } from '../types.js';

export function createInMemoryReportRepository(): ReportRepository {
  const rows: Array<CalibrationReport> = [];

  return {
    async insert(row) {
      rows.push(row);
    },

    async findLatest(tenant_id, prediction_kind) {
      let latest: CalibrationReport | null = null;
      for (const row of rows) {
        if (
          row.tenant_id !== tenant_id ||
          row.prediction_kind !== prediction_kind
        ) {
          continue;
        }
        if (
          latest === null ||
          new Date(row.report_period_end).getTime() >
            new Date(latest.report_period_end).getTime()
        ) {
          latest = row;
        }
      }
      return latest;
    },
  };
}

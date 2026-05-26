/**
 * Quality-signal repository — in-memory + SQL surface.
 *
 * One row per signal emitted by the Layer 4 composite gate. Production
 * wires a Drizzle-backed adapter against migration 0035's
 * `loop_quality_signals` table. The score-range guard mirrors the SQL
 * CHECK constraint.
 */

import {
  LoopRunnerError,
  type QualitySignalRepository,
  type QualitySignalRowInsert,
} from '../types.js';

export function createInMemoryQualitySignalRepository(): QualitySignalRepository & {
  readonly snapshot: () => ReadonlyArray<QualitySignalRowInsert>;
} {
  const rows: QualitySignalRowInsert[] = [];

  return {
    async insert(row) {
      if (row.score < 0 || row.score > 1) {
        throw new LoopRunnerError(
          `quality signal score must be within [0,1], got ${row.score}`,
          'INVALID_INPUT',
        );
      }
      if (row.weight < 0) {
        throw new LoopRunnerError(
          `quality signal weight must be non-negative, got ${row.weight}`,
          'INVALID_INPUT',
        );
      }
      rows.push(Object.freeze({ ...row }));
    },
    async listForRun(loopRunId) {
      return rows.filter((r) => r.loopRunId === loopRunId);
    },
    snapshot() {
      return rows.slice();
    },
  };
}

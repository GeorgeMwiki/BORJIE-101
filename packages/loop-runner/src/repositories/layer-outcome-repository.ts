/**
 * Layer-outcome repository — in-memory + SQL surface.
 *
 * One row per executed layer per loop run. Production wires a Drizzle-
 * backed adapter against migration 0035's `loop_layer_outcomes` table.
 */

import {
  LoopRunnerError,
  type LayerOutcomeRepository,
  type LayerOutcomeRowInsert,
} from '../types.js';

export function createInMemoryLayerOutcomeRepository(): LayerOutcomeRepository & {
  readonly snapshot: () => ReadonlyArray<LayerOutcomeRowInsert>;
} {
  const rows: LayerOutcomeRowInsert[] = [];

  return {
    async insert(row) {
      if (row.latencyMs < 0) {
        throw new LoopRunnerError(
          `layer outcome latencyMs must be non-negative, got ${row.latencyMs}`,
          'INVALID_INPUT',
        );
      }
      if (row.costUsdCents < 0) {
        throw new LoopRunnerError(
          `layer outcome costUsdCents must be non-negative, got ${row.costUsdCents}`,
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

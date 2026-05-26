/**
 * Loop-run repository — in-memory + SQL surface.
 *
 * The in-memory reference implementation is the test/dev port; production
 * wires a Drizzle-backed adapter that talks to migration 0035's
 * `loop_runs` table. The shape of the SQL repository contract is
 * documented here as a TypeScript interface so the database package
 * (or the API gateway composition root) can compile against it.
 */

import {
  LoopRunnerError,
  type LoopRunRepository,
  type LoopRunRowInsert,
  type LoopRunRowUpdate,
} from '../types.js';

export function createInMemoryLoopRunRepository(): LoopRunRepository & {
  readonly snapshot: () => ReadonlyArray<LoopRunRowInsert>;
} {
  const rows = new Map<string, LoopRunRowInsert>();

  return {
    async insert(row) {
      if (rows.has(row.id)) {
        throw new LoopRunnerError(
          `loop_run.id ${row.id} already exists`,
          'INVALID_INPUT',
        );
      }
      rows.set(row.id, Object.freeze({ ...row }));
    },
    async update(row: LoopRunRowUpdate) {
      const existing = rows.get(row.id);
      if (!existing) {
        throw new LoopRunnerError(
          `loop_run.id ${row.id} not found`,
          'INVALID_INPUT',
        );
      }
      rows.set(
        row.id,
        Object.freeze({
          ...existing,
          status: row.status,
          auditHash: row.auditHash,
        }),
      );
    },
    async find(id) {
      return rows.get(id) ?? null;
    },
    snapshot() {
      return Array.from(rows.values());
    },
  };
}

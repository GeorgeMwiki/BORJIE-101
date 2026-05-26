/**
 * Reinforcement repository — reference in-memory implementation
 * (Wave 18W). Tracks one row per `memory.reinforce` call. The
 * production Postgres impl writes to `cognitive_memory_reinforcements`
 * (migration 0027).
 */

import type { ReinforcementRepository } from '../types.js';

interface StoredReinforcement {
  readonly id: string;
  readonly cell_id: string;
  readonly tenant_id: string;
  readonly specialisation: string;
  readonly turn_id: string;
  readonly reinforced_at: string;
  readonly audit_hash: string;
}

export function createInMemoryReinforcementRepository(): ReinforcementRepository {
  const rows: StoredReinforcement[] = [];

  return {
    async insert(record): Promise<void> {
      rows.push({ ...record });
    },
    async listForCell(cellId): Promise<
      ReadonlyArray<{
        readonly id: string;
        readonly specialisation: string;
        readonly turn_id: string;
        readonly reinforced_at: string;
      }>
    > {
      return rows
        .filter((r) => r.cell_id === cellId)
        .map((r) => ({
          id: r.id,
          specialisation: r.specialisation,
          turn_id: r.turn_id,
          reinforced_at: r.reinforced_at,
        }));
    },
  };
}

/**
 * EvalRun repository — in-memory implementation backing the
 * `@borjie/language-self-improve` runner. Mirrors the persistence
 * surface of `language_eval_runs` (migration 0052).
 */

import type { EvalRun } from '../types.js';

export interface EvalRunRepository {
  insert(run: EvalRun): Promise<EvalRun>;
  findById(id: string): Promise<EvalRun | null>;
  listForAdapter(adapterId: string): Promise<ReadonlyArray<EvalRun>>;
  listForTenant(
    tenantId: string,
    limit?: number,
  ): Promise<ReadonlyArray<EvalRun>>;
}

export function createInMemoryEvalRunRepository(): EvalRunRepository {
  let store: ReadonlyMap<string, EvalRun> = new Map();

  const repo: EvalRunRepository = {
    async insert(run: EvalRun): Promise<EvalRun> {
      const next = new Map(store);
      const frozen = Object.freeze({ ...run });
      next.set(run.id, frozen);
      store = next;
      return frozen;
    },

    async findById(id: string): Promise<EvalRun | null> {
      return store.get(id) ?? null;
    },

    async listForAdapter(adapterId: string): Promise<ReadonlyArray<EvalRun>> {
      const filtered = Array.from(store.values()).filter(
        (r) => r.adapterId === adapterId,
      );
      filtered.sort((a, b) => b.ranAt.localeCompare(a.ranAt));
      return Object.freeze(filtered);
    },

    async listForTenant(
      tenantId: string,
      limit?: number,
    ): Promise<ReadonlyArray<EvalRun>> {
      const filtered = Array.from(store.values()).filter(
        (r) => r.tenantId === tenantId,
      );
      filtered.sort((a, b) => b.ranAt.localeCompare(a.ranAt));
      const sliced = limit !== undefined ? filtered.slice(0, limit) : filtered;
      return Object.freeze(sliced);
    },
  };

  return Object.freeze(repo);
}

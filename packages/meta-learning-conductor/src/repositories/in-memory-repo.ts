/**
 * In-memory repository for `MetaLearningRun` + `Example`.
 *
 * Backing store for tests and dev. Production composes the SQL
 * repository against the database client.
 */

import type { Example, MetaLearningRun } from '../types.js';

export interface MetaLearningRunRepository {
  readonly insertRun: (run: MetaLearningRun) => Promise<void>;
  readonly updateRun: (run: MetaLearningRun) => Promise<void>;
  readonly findLatestRun: (
    tenantId: string,
    capabilityId: string,
  ) => Promise<MetaLearningRun | null>;
  readonly listRuns: (
    tenantId: string,
    capabilityId: string,
  ) => Promise<ReadonlyArray<MetaLearningRun>>;
  readonly insertExamples: (
    examples: ReadonlyArray<Example>,
  ) => Promise<void>;
  readonly listExamples: (
    metaRunId: string,
  ) => Promise<ReadonlyArray<Example>>;
}

interface InternalState {
  readonly runs: Map<string, MetaLearningRun>;
  readonly examples: Map<string, ReadonlyArray<Example>>;
}

export function createInMemoryMetaLearningRepository(): MetaLearningRunRepository {
  const state: InternalState = Object.freeze({
    runs: new Map<string, MetaLearningRun>(),
    examples: new Map<string, ReadonlyArray<Example>>(),
  });

  return Object.freeze({
    async insertRun(run: MetaLearningRun): Promise<void> {
      if (state.runs.has(run.id)) {
        throw new Error(`Duplicate run id: ${run.id}`);
      }
      state.runs.set(run.id, run);
    },

    async updateRun(run: MetaLearningRun): Promise<void> {
      if (!state.runs.has(run.id)) {
        throw new Error(`Run not found: ${run.id}`);
      }
      state.runs.set(run.id, run);
    },

    async findLatestRun(
      tenantId: string,
      capabilityId: string,
    ): Promise<MetaLearningRun | null> {
      let best: MetaLearningRun | null = null;
      for (const run of state.runs.values()) {
        if (run.tenantId !== tenantId) continue;
        if (run.capabilityId !== capabilityId) continue;
        if (best === null || run.startedAt > best.startedAt) {
          best = run;
        }
      }
      return best;
    },

    async listRuns(
      tenantId: string,
      capabilityId: string,
    ): Promise<ReadonlyArray<MetaLearningRun>> {
      const out: MetaLearningRun[] = [];
      for (const run of state.runs.values()) {
        if (run.tenantId !== tenantId) continue;
        if (run.capabilityId !== capabilityId) continue;
        out.push(run);
      }
      out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      return Object.freeze(out);
    },

    async insertExamples(examples: ReadonlyArray<Example>): Promise<void> {
      if (examples.length === 0) return;
      const first = examples[0];
      if (!first) return;
      const metaRunId = first.metaRunId;
      const existing = state.examples.get(metaRunId) ?? [];
      const merged: Example[] = [...existing];
      for (const ex of examples) {
        if (ex.metaRunId !== metaRunId) {
          throw new Error('Mixed metaRunId in insertExamples');
        }
        merged.push(ex);
      }
      state.examples.set(metaRunId, Object.freeze(merged));
    },

    async listExamples(
      metaRunId: string,
    ): Promise<ReadonlyArray<Example>> {
      return state.examples.get(metaRunId) ?? [];
    },
  });
}

/**
 * `RlvrCuratedExampleRepository` — persistence port for `rlvr_curated_examples`.
 */

import type { CuratedExample } from '../types.js';

export interface RlvrCuratedExampleRepository {
  create(example: CuratedExample): Promise<CuratedExample>;
  listByRun(runId: string): Promise<ReadonlyArray<CuratedExample>>;
  listIncludedByRun(
    runId: string,
  ): Promise<ReadonlyArray<CuratedExample>>;
}

export function createInMemoryRlvrCuratedExampleRepository(): RlvrCuratedExampleRepository {
  let examples: ReadonlyArray<CuratedExample> = Object.freeze([]);

  return {
    async create(example: CuratedExample): Promise<CuratedExample> {
      if (examples.some((e) => e.id === example.id)) {
        throw new Error(`CuratedExample already exists: ${example.id}`);
      }
      examples = Object.freeze([...examples, example]);
      return example;
    },

    async listByRun(
      runId: string,
    ): Promise<ReadonlyArray<CuratedExample>> {
      return Object.freeze(examples.filter((e) => e.runId === runId));
    },

    async listIncludedByRun(
      runId: string,
    ): Promise<ReadonlyArray<CuratedExample>> {
      return Object.freeze(
        examples.filter((e) => e.runId === runId && e.included),
      );
    },
  };
}

/**
 * `RlvrTraceRepository` — persistence port for `rlvr_traces`.
 */

import type { RlvrTrace } from '../types.js';

export interface RlvrTraceRepository {
  create(trace: RlvrTrace): Promise<RlvrTrace>;
  attachRedacted(id: string, redacted: RlvrTrace): Promise<RlvrTrace>;
  findById(id: string): Promise<RlvrTrace | null>;
  listByRun(runId: string): Promise<ReadonlyArray<RlvrTrace>>;
}

interface StoredTrace {
  readonly raw: RlvrTrace;
  readonly redacted: RlvrTrace | null;
}

export function createInMemoryRlvrTraceRepository(): RlvrTraceRepository {
  let traces: ReadonlyArray<StoredTrace> = Object.freeze([]);

  return {
    async create(trace: RlvrTrace): Promise<RlvrTrace> {
      if (traces.some((t) => t.raw.id === trace.id)) {
        throw new Error(`RlvrTrace already exists: ${trace.id}`);
      }
      traces = Object.freeze([
        ...traces,
        Object.freeze({ raw: trace, redacted: null }),
      ]);
      return trace;
    },

    async attachRedacted(id: string, redacted: RlvrTrace): Promise<RlvrTrace> {
      const found = traces.find((t) => t.raw.id === id);
      if (!found) {
        throw new Error(`RlvrTrace not found: ${id}`);
      }
      traces = Object.freeze(
        traces.map((t) =>
          t.raw.id === id ? Object.freeze({ ...t, redacted }) : t,
        ),
      );
      return redacted;
    },

    async findById(id: string): Promise<RlvrTrace | null> {
      return traces.find((t) => t.raw.id === id)?.raw ?? null;
    },

    async listByRun(runId: string): Promise<ReadonlyArray<RlvrTrace>> {
      return Object.freeze(
        traces.filter((t) => t.raw.runId === runId).map((t) => t.raw),
      );
    },
  };
}

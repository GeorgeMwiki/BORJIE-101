/**
 * Trace collector — capture a Mr. Mwikila session into an `RlvrTrace`.
 *
 * The collector is dependency-injected with an `IdGen` + `Clock` so
 * the runner can produce deterministic traces in tests. Synthetic
 * traces MUST carry `metadata.synthetic === true`; the production
 * runner enforces this at the curator boundary.
 */

import type {
  RlvrTrace,
  RlvrToolCall,
} from '../types.js';

export interface IdGen {
  (): string;
}

export interface Clock {
  (): Date;
}

export interface CollectTraceInput {
  readonly runId: string;
  readonly tenantId: string;
  readonly prompt: string;
  readonly completion: string;
  readonly toolCalls?: ReadonlyArray<RlvrToolCall>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TraceCollectorConfig {
  readonly idGen: IdGen;
  readonly clock: Clock;
}

export function createTraceCollector(config: TraceCollectorConfig) {
  return {
    collect(input: CollectTraceInput): RlvrTrace {
      return Object.freeze({
        id: config.idGen(),
        runId: input.runId,
        tenantId: input.tenantId,
        prompt: input.prompt,
        completion: input.completion,
        toolCalls: Object.freeze([...(input.toolCalls ?? [])]),
        metadata: Object.freeze({ ...(input.metadata ?? {}) }),
        capturedAt: config.clock().toISOString(),
      });
    },
  };
}

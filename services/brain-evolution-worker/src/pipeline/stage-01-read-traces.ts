/**
 * Stage 01 — read the last 24h of interaction traces for a tenant.
 *
 * Pulls from the existing trace storage (`kernel_memory_episodic`,
 * `kernel_action_audit`, and `ai_audit_chain`) via a `TraceReader` port.
 * Returns a normalised `InteractionTrace[]` ordered oldest-first so the
 * reflection stage sees the day chronologically.
 *
 * Pure function over the port: same trace set always yields the same
 * normalised output. The composition root wires a real Drizzle-backed
 * reader; tests pass a stub.
 *
 * Bounded by `maxTraces` (default 5000) so a chatty tenant cannot starve
 * the worker. Anything beyond the cap is dropped with a warning — the
 * day's "shape" survives sampling.
 */

import type {
  InteractionTrace,
  BrainWorkerLogger,
} from '../types.js';

/**
 * Storage port — the composition root wires this to real DB queries.
 * The worker never talks to Drizzle directly.
 */
export interface TraceReader {
  /**
   * Read all traces for `tenantId` whose `capturedAt` falls in
   * `[windowStart, windowEnd)`. Limit is a soft cap — return at most
   * `limit` rows ordered oldest-first.
   */
  readTraces(args: {
    readonly tenantId: string;
    readonly windowStart: Date;
    readonly windowEnd: Date;
    readonly limit: number;
  }): Promise<ReadonlyArray<InteractionTrace>>;
}

export interface ReadTracesArgs {
  readonly tenantId: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly maxTraces?: number;
  readonly logger?: BrainWorkerLogger;
}

export interface ReadTracesResult {
  readonly tenantId: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly traces: ReadonlyArray<InteractionTrace>;
  readonly truncated: boolean;
}

const DEFAULT_MAX_TRACES = 5000;

/**
 * Run stage 01. Catches reader failures and downgrades them to an empty
 * trace set — the worker continues, the report shows `tracesRead=0`.
 */
export async function readDailyTraces(
  reader: TraceReader,
  args: ReadTracesArgs,
): Promise<ReadTracesResult> {
  const maxTraces = clampPositiveInt(args.maxTraces, DEFAULT_MAX_TRACES);
  const logger = args.logger;

  try {
    const traces = await reader.readTraces({
      tenantId: args.tenantId,
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
      limit: maxTraces + 1,
    });

    const truncated = traces.length > maxTraces;
    const kept = truncated ? traces.slice(0, maxTraces) : traces;

    if (truncated) {
      logger?.warn?.(
        {
          tenantId: args.tenantId,
          maxTraces,
          dropped: traces.length - maxTraces,
        },
        'brain-evolution-worker: trace read truncated — day too chatty for cap',
      );
    }

    return {
      tenantId: args.tenantId,
      windowStart: args.windowStart.toISOString(),
      windowEnd: args.windowEnd.toISOString(),
      traces: kept,
      truncated,
    };
  } catch (error) {
    logger?.warn?.(
      {
        tenantId: args.tenantId,
        err: error instanceof Error ? error.message : String(error),
      },
      'brain-evolution-worker: trace read failed — degrading to empty set',
    );
    return {
      tenantId: args.tenantId,
      windowStart: args.windowStart.toISOString(),
      windowEnd: args.windowEnd.toISOString(),
      traces: [],
      truncated: false,
    };
  }
}

function clampPositiveInt(
  candidate: number | undefined,
  fallback: number,
): number {
  if (
    typeof candidate !== 'number' ||
    !Number.isFinite(candidate) ||
    candidate <= 0
  ) {
    return fallback;
  }
  return Math.min(Math.floor(candidate), 50000);
}

/**
 * Decision-trace query adapter — backs the HQ-tier
 * `platform.list_recent_traces` tool (Central Command Phase B — B1,
 * TIER 2).
 *
 * NOT a DB read. The K1 wave wired an in-memory `DecisionTraceRecorder`
 * onto the kernel (see `services.decisionTraceRecorder` slot in the
 * api-gateway composition root). This adapter is a thin facade that
 * paginates + filters the recorder's recent traces so the HQ tool
 * surface stays in line with the other adapters' shape.
 *
 * The recorder API is duck-typed locally so this package does NOT
 * compile-time depend on `@borjie/central-intelligence`.
 */

import { logger } from '../../logger.js';
export interface DecisionTraceRow {
  readonly traceId: string;
  readonly threadId: string;
  readonly tenantId: string | null;
  readonly capability: string | null;
  readonly score: number | null;
  readonly stepCount: number;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

export interface DecisionTraceQueryArgs {
  readonly limit: number;
  readonly capability: string | null;
  readonly scoreMin: number | null;
  readonly tenantId: string | null;
}

export interface DecisionTraceQueryService {
  listRecent(
    args: DecisionTraceQueryArgs,
  ): Promise<ReadonlyArray<DecisionTraceRow>>;
}

/**
 * The kernel `DecisionTraceRecorder` exposes (at least) `listRecent`
 * returning ALL recently captured traces ordered newest-first. The
 * shape is structural so we don't bind to a specific kernel version.
 */
export interface DecisionTraceRecorderLike {
  listRecent(): ReadonlyArray<DecisionTraceRow> | Promise<ReadonlyArray<DecisionTraceRow>>;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

export function createDecisionTraceQueryService(
  recorder: DecisionTraceRecorderLike,
): DecisionTraceQueryService {
  return {
    async listRecent(args) {
      try {
        const limit = clampLimit(args.limit);
        const raw = await Promise.resolve(recorder.listRecent());
        const filtered = (raw ?? []).filter((row) => {
          if (args.capability && row.capability !== args.capability) {
            return false;
          }
          if (
            args.scoreMin !== null &&
            (row.score === null || row.score < args.scoreMin)
          ) {
            return false;
          }
          if (args.tenantId && row.tenantId !== args.tenantId) {
            return false;
          }
          return true;
        });
        return filtered.slice(0, limit);
      } catch (error) {
        logger.error('platform.decisionTraces.listRecent failed', { error: error });
        return [];
      }
    },
  };
}

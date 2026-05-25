/**
 * MCP cost-persistence — batched writer.
 *
 * Buffers cost entries until BATCH_SIZE OR FLUSH_INTERVAL_MS, then
 * flushes via the injected CostSink. Survives transient sink
 * failures: failed entries are returned to the buffer for the next
 * flush.
 *
 * Pure-ish — no I/O beyond the injected sink. Caller schedules
 * `flush` via setInterval, or call `flush()` manually.
 */

import type { CostSink, McpCostEntry, McpCostSnapshot, ModelTier } from "./types.js";

const DEFAULT_BATCH_SIZE = 10;

export interface CostBufferState {
  readonly pending: ReadonlyArray<McpCostEntry>;
  readonly totals: McpCostSnapshot;
}

const EMPTY_TIERS: Record<ModelTier, number> = {
  free: 0,
  cheap: 0,
  standard: 0,
  premium: 0,
};

export function createCostBuffer(
  periodStartIso?: string,
  periodEndIso?: string,
): CostBufferState {
  const now = new Date().toISOString();
  return {
    pending: [],
    totals: {
      totalCostUsd: 0,
      costByTier: { ...EMPTY_TIERS },
      costByServer: {},
      freeCallCount: 0,
      paidCallCount: 0,
      periodStartIso: periodStartIso ?? now,
      periodEndIso: periodEndIso ?? now,
    },
  };
}

function foldEntry(
  snap: McpCostSnapshot,
  entry: McpCostEntry,
): McpCostSnapshot {
  const cost = entry.estimatedCostUsd;
  return {
    totalCostUsd: snap.totalCostUsd + cost,
    costByTier: {
      ...snap.costByTier,
      [entry.tier]: (snap.costByTier[entry.tier] ?? 0) + cost,
    },
    costByServer: {
      ...snap.costByServer,
      [entry.serverId]: (snap.costByServer[entry.serverId] ?? 0) + cost,
    },
    freeCallCount: snap.freeCallCount + (entry.wasFree ? 1 : 0),
    paidCallCount: snap.paidCallCount + (entry.wasFree ? 0 : 1),
    periodStartIso: snap.periodStartIso,
    periodEndIso: snap.periodEndIso,
  };
}

/**
 * Append a cost entry and return the next state. Pure; caller must
 * keep the returned state for the next call.
 */
export function appendCost(
  state: CostBufferState,
  entry: McpCostEntry,
): CostBufferState {
  return {
    pending: [...state.pending, entry],
    totals: foldEntry(state.totals, entry),
  };
}

export interface FlushOptions {
  readonly batchSize?: number;
}

export interface FlushResult {
  readonly state: CostBufferState;
  readonly flushed: number;
  readonly errored: boolean;
}

/**
 * Flush pending entries to the sink. Returns the next state plus the
 * flush outcome. On error, entries are RE-INSERTED into pending for
 * the next call — the totals counter is only debited on successful
 * flush. (This means totals reflect attempted spend, not confirmed
 * persistence — which is the correct accounting for budget gating.)
 */
export async function flushCost(
  state: CostBufferState,
  sink: CostSink,
  options: FlushOptions = {},
): Promise<FlushResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (state.pending.length === 0) {
    return { state, flushed: 0, errored: false };
  }
  const toFlush = state.pending.slice(0, batchSize);
  const remaining = state.pending.slice(batchSize);
  try {
    await sink.insert(toFlush);
    return {
      state: { ...state, pending: remaining },
      flushed: toFlush.length,
      errored: false,
    };
  } catch {
    // Retry-bound: keep entries in the buffer.
    return { state, flushed: 0, errored: true };
  }
}

/**
 * Drain the buffer in batches until empty OR the sink errors.
 */
export async function flushAll(
  state: CostBufferState,
  sink: CostSink,
  options: FlushOptions = {},
): Promise<FlushResult> {
  let current = state;
  let totalFlushed = 0;
  for (;;) {
    const r = await flushCost(current, sink, options);
    if (r.errored) return r;
    if (r.flushed === 0) {
      return { state: current, flushed: totalFlushed, errored: false };
    }
    current = r.state;
    totalFlushed += r.flushed;
  }
}

/**
 * Read the running snapshot. Useful for budget gating without
 * touching the sink.
 */
export function snapshot(state: CostBufferState): McpCostSnapshot {
  return state.totals;
}

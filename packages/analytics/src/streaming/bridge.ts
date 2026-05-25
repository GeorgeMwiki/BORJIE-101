/**
 * Realtime bridge — turns widget refresh requests into a throttled
 * AsyncIterable of `DataDelta` updates.
 *
 * We do NOT depend on `@borjie/realtime-adapter` at the type level.
 * The bridge accepts a thin `RealtimePort` that emits messages keyed
 * by widget id. Throttling is applied per-widget (default 1Hz) to keep
 * the renderer from re-running expensive chart layouts on every tick.
 *
 * SOTA pattern: ClickHouse / Materialize push deltas; the chart
 * renderer applies them as `vega-lite` data updates rather than
 * re-rendering. Our delta is the rows the renderer should swap into
 * `data.values` (or apply as a Vega data update transaction).
 */

import type { DataDelta, ParsedRow } from '../types.js';

export interface RealtimePort {
  subscribe(channel: string, handler: (rows: readonly ParsedRow[]) => void): { unsubscribe(): void };
}

export interface SubscribeOptions {
  readonly widgetId: string;
  /** Channel name — e.g. `tenant.<tid>.payments`. */
  readonly channel: string;
  readonly realtime: RealtimePort;
  /** Min ms between emitted deltas. Default 1000 (1Hz). */
  readonly throttleMs?: number;
  /** AbortSignal terminates the iterable. */
  readonly signal?: AbortSignal;
}

/**
 * Produce an `AsyncIterable<DataDelta>` for a widget. Backpressure-safe:
 * the buffer holds at most one delta; older deltas are coalesced into
 * the newer one (last-write-wins).
 */
export function subscribeToWidget(opts: SubscribeOptions): AsyncIterable<DataDelta> {
  const throttle = Math.max(0, opts.throttleMs ?? 1000);

  let pending: readonly ParsedRow[] | null = null;
  // Start the throttle window at subscription time so the first push is
  // throttled too. This is the correct semantic for "first push within
  // window N is the only push you see" — consumers running expensive
  // chart layout want that bound from t=0, not from t=firstPush.
  let lastEmitAt = Date.now();
  let flushScheduled = false;
  let resolver: ((v: IteratorResult<DataDelta>) => void) | null = null;
  let closed = false;

  const sub = opts.realtime.subscribe(opts.channel, (rows) => {
    if (closed) return;
    pending = rows;
    if (!resolver || flushScheduled) return;
    const wait = Math.max(0, throttle - (Date.now() - lastEmitAt));
    const flush = (): void => {
      flushScheduled = false;
      if (!resolver || pending === null) return;
      const rowsToSend = pending;
      pending = null;
      lastEmitAt = Date.now();
      const r = resolver;
      resolver = null;
      r({
        done: false,
        value: { widgetId: opts.widgetId, rows: rowsToSend, emittedAt: new Date(lastEmitAt).toISOString() },
      });
    };
    if (wait === 0) {
      flush();
    } else {
      flushScheduled = true;
      setTimeout(flush, wait);
    }
  });

  function cleanup(): void {
    if (closed) return;
    closed = true;
    sub.unsubscribe();
    if (resolver) {
      const r = resolver;
      resolver = null;
      r({ done: true, value: undefined as unknown as DataDelta });
    }
  }

  opts.signal?.addEventListener('abort', cleanup);

  const iterator: AsyncIterator<DataDelta> = {
    next() {
      if (closed) return Promise.resolve({ done: true, value: undefined as unknown as DataDelta });
      if (pending !== null) {
        // Drain the pending delta if throttle elapsed.
        const now = Date.now();
        const wait = Math.max(0, throttle - (now - lastEmitAt));
        if (wait === 0) {
          const rows = pending;
          pending = null;
          lastEmitAt = now;
          return Promise.resolve({
            done: false,
            value: { widgetId: opts.widgetId, rows, emittedAt: new Date(now).toISOString() },
          });
        }
      }
      return new Promise<IteratorResult<DataDelta>>((resolve) => {
        resolver = resolve;
      });
    },
    return() {
      cleanup();
      return Promise.resolve({ done: true, value: undefined as unknown as DataDelta });
    },
  };

  return {
    [Symbol.asyncIterator]() {
      return iterator;
    },
  };
}

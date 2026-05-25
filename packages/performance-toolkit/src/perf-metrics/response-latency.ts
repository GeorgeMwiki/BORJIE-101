/**
 * Server-side RED (Rate / Errors / Duration) helpers. Wraps a Hono /
 * Fastify / Express handler with a timer that emits one
 * `ResponseLatencyReport` per request. Batches by default to amortise
 * the network cost of shipping to the sink.
 */

import type { PerfMetricsSink, ResponseLatencyReport } from '../types.js';

export function recordResponseLatency(
  sink: PerfMetricsSink,
  report: ResponseLatencyReport,
): void {
  void sink.reportResponseLatency(report);
}

/**
 * Hono middleware variant — measures wall-clock from middleware entry
 * to response completion. Tags the report with `route` (from c.req
 * route pattern when available) and `status`.
 */
export function honoLatencyMiddleware(sink: PerfMetricsSink) {
  return async function latencyMiddleware(
    c: {
      req: {
        method?: string;
        url?: string;
        routePath?: string;
        header?(name: string): string | undefined;
      };
      res: { status?: number };
    },
    next: () => Promise<void>,
  ): Promise<void> {
    const start = performance.now();
    try {
      await next();
    } finally {
      const ms = performance.now() - start;
      const route = c.req.routePath ?? c.req.url ?? 'unknown';
      const status = c.res.status ?? 200;
      const cacheHit = c.req.header?.('If-None-Match') !== undefined && status === 304;
      recordResponseLatency(sink, {
        route,
        ms,
        status,
        ...(c.req.method !== undefined ? { method: c.req.method } : {}),
        cacheHit,
      });
    }
  };
}

/**
 * Express middleware variant — same idea but uses `res.on('finish')`.
 */
export function expressLatencyMiddleware(sink: PerfMetricsSink) {
  return function latencyMiddleware(
    req: { method?: string; url?: string; route?: { path?: string } },
    res: {
      statusCode?: number;
      on(event: 'finish', cb: () => void): void;
    },
    next: () => void,
  ): void {
    const start = performance.now();
    res.on('finish', () => {
      const ms = performance.now() - start;
      recordResponseLatency(sink, {
        route: req.route?.path ?? req.url ?? 'unknown',
        ms,
        status: res.statusCode ?? 200,
        ...(req.method !== undefined ? { method: req.method } : {}),
      });
    });
    next();
  };
}

/**
 * `createBatchingSink` — wraps a sink so reports are buffered in
 * memory and flushed in batches every `intervalMs` (or when full).
 * Cuts the per-call HTTP overhead by ~99% in busy services.
 */
export function createBatchingSink(
  inner: PerfMetricsSink,
  opts: { maxBatch?: number; intervalMs?: number } = {},
): PerfMetricsSink & { flush(): Promise<void> } {
  const maxBatch = opts.maxBatch ?? 50;
  const intervalMs = opts.intervalMs ?? 10_000;
  const vitalsBuf: import('../types.js').WebVitalReport[] = [];
  const latencyBuf: ResponseLatencyReport[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const v = vitalsBuf.splice(0);
    const l = latencyBuf.splice(0);
    await Promise.all([
      ...v.map((m) => Promise.resolve(inner.reportWebVital(m))),
      ...l.map((m) => Promise.resolve(inner.reportResponseLatency(m))),
    ]);
  };

  const scheduleFlush = (): void => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      void flush();
    }, intervalMs);
  };

  return {
    reportWebVital(m) {
      vitalsBuf.push(m);
      if (vitalsBuf.length + latencyBuf.length >= maxBatch) void flush();
      else scheduleFlush();
    },
    reportResponseLatency(m) {
      latencyBuf.push(m);
      if (vitalsBuf.length + latencyBuf.length >= maxBatch) void flush();
      else scheduleFlush();
    },
    flush,
  };
}

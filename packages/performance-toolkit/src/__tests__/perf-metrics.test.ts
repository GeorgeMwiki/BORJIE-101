import { describe, expect, it, vi } from 'vitest';
import { classifyWebVital } from '../perf-metrics/report-web-vitals.js';
import {
  createBatchingSink,
  honoLatencyMiddleware,
  recordResponseLatency,
} from '../perf-metrics/response-latency.js';
import type { PerfMetricsSink, WebVitalReport } from '../types.js';

describe('classifyWebVital — 2026 Google thresholds', () => {
  it('LCP good <= 2500ms', () => {
    expect(classifyWebVital('LCP', 2000)).toBe('good');
    expect(classifyWebVital('LCP', 2500)).toBe('good');
  });

  it('LCP needs-improvement 2500-4000', () => {
    expect(classifyWebVital('LCP', 3000)).toBe('needs-improvement');
  });

  it('LCP poor > 4000', () => {
    expect(classifyWebVital('LCP', 5000)).toBe('poor');
  });

  it('INP good <= 200ms (the 2024 replacement for FID)', () => {
    expect(classifyWebVital('INP', 150)).toBe('good');
    expect(classifyWebVital('INP', 200)).toBe('good');
  });

  it('INP poor > 500ms (43% of sites fail this in 2026)', () => {
    expect(classifyWebVital('INP', 750)).toBe('poor');
  });

  it('CLS good <= 0.1', () => {
    expect(classifyWebVital('CLS', 0.05)).toBe('good');
    expect(classifyWebVital('CLS', 0.1)).toBe('good');
  });

  it('CLS poor > 0.25', () => {
    expect(classifyWebVital('CLS', 0.4)).toBe('poor');
  });

  it('TTFB good <= 800ms', () => {
    expect(classifyWebVital('TTFB', 500)).toBe('good');
    expect(classifyWebVital('TTFB', 800)).toBe('good');
  });

  it('FCP good <= 1800ms', () => {
    expect(classifyWebVital('FCP', 1500)).toBe('good');
  });
});

function makeSink(): PerfMetricsSink & {
  vitals: WebVitalReport[];
  latencies: { route: string; ms: number }[];
} {
  const vitals: WebVitalReport[] = [];
  const latencies: { route: string; ms: number }[] = [];
  return {
    vitals,
    latencies,
    reportWebVital(m) {
      vitals.push(m);
    },
    reportResponseLatency(m) {
      latencies.push({ route: m.route, ms: m.ms });
    },
  };
}

describe('recordResponseLatency', () => {
  it('forwards to sink', () => {
    const sink = makeSink();
    recordResponseLatency(sink, { route: '/x', ms: 12.5, status: 200 });
    expect(sink.latencies).toEqual([{ route: '/x', ms: 12.5 }]);
  });
});

describe('honoLatencyMiddleware', () => {
  it('records request duration with route + status', async () => {
    const sink = makeSink();
    const mw = honoLatencyMiddleware(sink);
    await mw(
      {
        req: { method: 'GET', routePath: '/api/v1/properties' },
        res: { status: 200 },
      },
      async () => {
        await new Promise((r) => setTimeout(r, 5));
      },
    );
    expect(sink.latencies).toHaveLength(1);
    expect(sink.latencies[0]!.route).toBe('/api/v1/properties');
    expect(sink.latencies[0]!.ms).toBeGreaterThanOrEqual(4);
  });
});

describe('createBatchingSink', () => {
  it('batches reports and flushes once interval elapses', async () => {
    const innerVitals = vi.fn();
    const innerLatency = vi.fn();
    const batched = createBatchingSink(
      {
        reportWebVital: innerVitals,
        reportResponseLatency: innerLatency,
      },
      { intervalMs: 20, maxBatch: 100 },
    );
    batched.reportResponseLatency({ route: '/a', ms: 1, status: 200 });
    batched.reportResponseLatency({ route: '/b', ms: 2, status: 200 });
    expect(innerLatency).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 40));
    expect(innerLatency).toHaveBeenCalledTimes(2);
  });

  it('flushes immediately when maxBatch reached', async () => {
    const innerLatency = vi.fn();
    const batched = createBatchingSink(
      { reportWebVital: vi.fn(), reportResponseLatency: innerLatency },
      { intervalMs: 60_000, maxBatch: 2 },
    );
    batched.reportResponseLatency({ route: '/a', ms: 1, status: 200 });
    batched.reportResponseLatency({ route: '/b', ms: 2, status: 200 });
    await new Promise((r) => setTimeout(r, 5));
    expect(innerLatency).toHaveBeenCalledTimes(2);
  });
});

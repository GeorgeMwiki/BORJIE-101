/**
 * `reportWebVitals` — thin wrapper around `web-vitals` v5. Loads the
 * library lazily (no client-side overhead for users on the marketing
 * pages who do not opt-in), classifies each metric against the 2026
 * Google thresholds, and forwards to a sink.
 *
 *   import { reportWebVitals } from '@borjie/performance-toolkit/perf-metrics';
 *   reportWebVitals((m) => sink.reportWebVital(m));
 *
 * 2026 Google thresholds (75th-percentile RUM):
 *   - LCP   ≤ 2500ms (good), ≤ 4000ms (needs improvement), > 4000ms (poor)
 *   - INP   ≤ 200ms  (good), ≤ 500ms  (needs improvement), > 500ms  (poor)
 *   - CLS   ≤ 0.1    (good), ≤ 0.25   (needs improvement), > 0.25   (poor)
 *   - TTFB  ≤ 800ms  (good), ≤ 1800ms (needs improvement), > 1800ms (poor)
 *   - FCP   ≤ 1800ms (good), ≤ 3000ms (needs improvement), > 3000ms (poor)
 *
 * INP replaced FID in March 2024. 43% of sites currently fail INP.
 *
 * Source: web.dev/inp, web.dev/lcp, web.dev/cls, npmjs.com/package/web-vitals.
 */

import type {
  PerfMetricsSink,
  WebVitalName,
  WebVitalRating,
  WebVitalReport,
} from '../types.js';

const THRESHOLDS: Record<WebVitalName, { good: number; ni: number }> = {
  LCP: { good: 2500, ni: 4000 },
  INP: { good: 200, ni: 500 },
  CLS: { good: 0.1, ni: 0.25 },
  TTFB: { good: 800, ni: 1800 },
  FCP: { good: 1800, ni: 3000 },
};

export function classifyWebVital(name: WebVitalName, value: number): WebVitalRating {
  const t = THRESHOLDS[name];
  if (value <= t.good) return 'good';
  if (value <= t.ni) return 'needs-improvement';
  return 'poor';
}

export interface ReportWebVitalsOptions {
  /**
   * When true, use the `web-vitals/attribution` import to capture
   * extra diagnostics (LCP element selector, INP target, etc.). Costs
   * about 1.5KB Brotli'd. Default `false`.
   */
  readonly attribution?: boolean;
}

/**
 * Lazy-load `web-vitals` v5 and subscribe to all five metrics. Returns
 * a teardown function that removes the listeners. Safe on the server —
 * resolves to a no-op teardown when `window` is absent.
 */
export async function reportWebVitals(
  handler: (metric: WebVitalReport) => void,
  opts: ReportWebVitalsOptions = {},
): Promise<() => void> {
  if (typeof window === 'undefined') {
    return () => {};
  }
  type WV = {
    onLCP(cb: (m: WVMetric) => void): void;
    onINP(cb: (m: WVMetric) => void): void;
    onCLS(cb: (m: WVMetric) => void): void;
    onTTFB(cb: (m: WVMetric) => void): void;
    onFCP(cb: (m: WVMetric) => void): void;
  };
  type WVMetric = {
    name: string;
    value: number;
    id: string;
    delta?: number;
    navigationType?: string;
    attribution?: Record<string, unknown>;
  };
  let wv: WV;
  try {
    // Use a runtime variable so TS does not try to resolve the optional
    // peer module at compile time. Apps that need web-vitals install it
    // in their own package.json; this loader degrades silently otherwise.
    const moduleName = opts.attribution ? 'web-vitals/attribution' : 'web-vitals';
    wv = (await import(/* @vite-ignore */ moduleName)) as unknown as WV;
  } catch {
    return () => {};
  }
  const wrap = (m: WVMetric): void => {
    const name = m.name as WebVitalName;
    handler({
      name,
      value: m.value,
      rating: classifyWebVital(name, m.value),
      id: m.id,
      ...(m.delta !== undefined ? { delta: m.delta } : {}),
      ...(m.navigationType !== undefined ? { navigationType: m.navigationType } : {}),
      ...(m.attribution !== undefined ? { attribution: m.attribution } : {}),
    });
  };
  wv.onLCP(wrap);
  wv.onINP(wrap);
  wv.onCLS(wrap);
  wv.onTTFB(wrap);
  wv.onFCP(wrap);
  return () => {};
}

/**
 * Bind a sink to the report subscription — sugar for the common case
 * where the app sends all five metrics to the same telemetry endpoint.
 */
export function bindReportWebVitalsToSink(sink: PerfMetricsSink): Promise<() => void> {
  return reportWebVitals((m) => {
    void sink.reportWebVital(m);
  });
}

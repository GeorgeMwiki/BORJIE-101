/**
 * Perf-metrics barrel — web-vitals + RED metrics + batching sink.
 */

import type { PerfMetricsSink } from '../types.js';

export {
  classifyWebVital,
  reportWebVitals,
  bindReportWebVitalsToSink,
} from './report-web-vitals.js';
export type { ReportWebVitalsOptions } from './report-web-vitals.js';
export {
  recordResponseLatency,
  honoLatencyMiddleware,
  expressLatencyMiddleware,
  createBatchingSink,
} from './response-latency.js';

import { bindReportWebVitalsToSink } from './report-web-vitals.js';
import {
  recordResponseLatency,
  honoLatencyMiddleware,
  expressLatencyMiddleware,
} from './response-latency.js';

/**
 * `bindSink` — auto-wire all sink consumers to one sink instance.
 * Used by the composition root.
 */
export function bindSink(sink: PerfMetricsSink) {
  return {
    bindReportWebVitals: () => bindReportWebVitalsToSink(sink),
    recordResponseLatency: (report: import('../types.js').ResponseLatencyReport) =>
      recordResponseLatency(sink, report),
    honoLatencyMiddleware: () => honoLatencyMiddleware(sink),
    expressLatencyMiddleware: () => expressLatencyMiddleware(sink),
  };
}

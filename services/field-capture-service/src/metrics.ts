/**
 * Prometheus metrics — counters + histograms for the field-capture surface.
 */

import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

export interface MetricsHarness {
  readonly registry: Registry;
  readonly captureCounter: Counter<string>;
  readonly captureLatency: Histogram<string>;
}

export function createMetrics(): MetricsHarness {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'field_capture_' });

  const captureCounter = new Counter({
    name: 'field_capture_submissions_total',
    help: 'Total field capture submissions',
    labelNames: ['kind', 'status'],
    registers: [registry],
  });
  const captureLatency = new Histogram({
    name: 'field_capture_processing_duration_seconds',
    help: 'Field capture processing duration',
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
    labelNames: ['kind'],
    registers: [registry],
  });

  return Object.freeze({
    registry,
    captureCounter,
    captureLatency,
  });
}

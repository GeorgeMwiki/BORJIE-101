/**
 * Unit tests for the kernel metrics module.
 *
 * We register a MeterProvider with an InMemoryMetricExporter so each
 * call's instrumentation is observable without an OTLP backend.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { metrics } from '@opentelemetry/api';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  InMemoryMetricExporter,
  AggregationTemporality,
  type MetricData,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';

import {
  recordKernelTurn,
  recordSensorCall,
  recordGateBlocked,
  recordDriftDetected,
  recordTenantBudgetExceeded,
  setPrivacyBudgetEpsilon,
  getPrivacyBudgetEpsilon,
  __resetKernelMetricsForTests,
  KERNEL_METRIC_LABELS,
} from '../metrics';

let provider: MeterProvider;
let exporter: InMemoryMetricExporter;
let reader: PeriodicExportingMetricReader;

async function collect(): Promise<ResourceMetrics[]> {
  await reader.forceFlush();
  const data = exporter.getMetrics();
  // Reset between assertions so each test sees a clean ledger.
  exporter.reset();
  return data;
}

function findMetric(rms: ResourceMetrics[], name: string): MetricData | null {
  for (const rm of rms) {
    for (const sm of rm.scopeMetrics) {
      for (const m of sm.metrics) {
        if (m.descriptor.name === name) return m;
      }
    }
  }
  return null;
}

beforeEach(() => {
  exporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
  reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 60_000,
  });
  provider = new MeterProvider({ readers: [reader] });
  metrics.setGlobalMeterProvider(provider);
  __resetKernelMetricsForTests();
});

afterEach(async () => {
  await reader.shutdown();
  await provider.shutdown();
  metrics.disable();
  __resetKernelMetricsForTests();
});

describe('kernel metrics', () => {
  it('records a kernel turn duration histogram and total counter', async () => {
    recordKernelTurn({
      surface: 'tenant-app',
      stakes: 'medium',
      scopeKind: 'tenant',
      decisionKind: 'answer',
      durationMs: 412,
    });
    recordKernelTurn({
      surface: 'tenant-app',
      stakes: 'medium',
      scopeKind: 'tenant',
      decisionKind: 'answer',
      durationMs: 280,
    });
    const data = await collect();
    const histogram = findMetric(data, 'borjie.kernel.turn.duration_ms');
    const counter = findMetric(data, 'borjie.kernel.turn.total');
    expect(histogram).not.toBeNull();
    expect(counter).not.toBeNull();
    expect(counter!.dataPoints[0]!.value).toBe(2);
  });

  it('counts gate blocks scoped by gate + surface', async () => {
    recordGateBlocked({ gate: 'policy', surface: 'admin-portal' });
    recordGateBlocked({ gate: 'policy', surface: 'admin-portal' });
    recordGateBlocked({ gate: 'drift', surface: 'admin-portal' });
    const data = await collect();
    const m = findMetric(data, 'borjie.kernel.gate.blocked.total');
    expect(m).not.toBeNull();
    // Two label-tuples → two data points; aggregate to 3 events total.
    const total = (m!.dataPoints as Array<{ value: number }>).reduce(
      (sum, dp) => sum + dp.value,
      0,
    );
    expect(total).toBe(3);
  });

  it('counts sensor token consumption with the sensorId label', async () => {
    recordSensorCall({
      sensorId: 'anthropic.sonnet',
      modelId: 'claude-3-7-sonnet-20250219',
      durationMs: 612,
      inputTokens: 1024,
      outputTokens: 512,
    });
    const data = await collect();
    const inMetric = findMetric(data, 'borjie.sensor.tokens.input.total');
    const outMetric = findMetric(data, 'borjie.sensor.tokens.output.total');
    expect(inMetric).not.toBeNull();
    expect(outMetric).not.toBeNull();
    expect(inMetric!.dataPoints[0]!.value).toBe(1024);
    expect(outMetric!.dataPoints[0]!.value).toBe(512);
  });

  it('drift counter records per-violation labels', async () => {
    recordDriftDetected({ violationType: 'persona-leak' });
    recordDriftDetected({ violationType: 'persona-leak' });
    recordDriftDetected({ violationType: 'safety-bypass' });
    const data = await collect();
    const m = findMetric(data, 'borjie.kernel.drift.detected.total');
    expect(m).not.toBeNull();
    const dps = m!.dataPoints as Array<{ value: number; attributes: Record<string, unknown> }>;
    expect(dps.length).toBe(2);
    const personaLeak = dps.find((dp) => dp.attributes.violation_type === 'persona-leak');
    expect(personaLeak?.value).toBe(2);
  });

  it('tenant-budget counter ticks once per rejection', async () => {
    recordTenantBudgetExceeded({ surface: 'jarvis' });
    recordTenantBudgetExceeded({ surface: 'jarvis' });
    const data = await collect();
    const m = findMetric(data, 'borjie.tenant.budget.exceeded.total');
    expect(m).not.toBeNull();
    expect(m!.dataPoints[0]!.value).toBe(2);
  });

  it('privacy budget gauge reflects the most recent setter call', async () => {
    setPrivacyBudgetEpsilon(0.91);
    expect(getPrivacyBudgetEpsilon()).toBeCloseTo(0.91);
    setPrivacyBudgetEpsilon(0.42);
    expect(getPrivacyBudgetEpsilon()).toBeCloseTo(0.42);
  });

  it('label allowlist drops cardinality-unsafe keys', async () => {
    // sneak in an extra label and assert the recorder does not surface it
    recordKernelTurn({
      surface: 'tenant-app',
      stakes: 'low',
      scopeKind: 'tenant',
      decisionKind: 'answer',
      durationMs: 100,
      // @ts-expect-error: intentional cardinality-leak attempt
      tenantId: 'tnt-001',
    } as Parameters<typeof recordKernelTurn>[0]);
    const data = await collect();
    const counter = findMetric(data, 'borjie.kernel.turn.total');
    expect(counter).not.toBeNull();
    const dp = counter!.dataPoints[0]!;
    // tenantId must not appear on the counter labels — we only allow surface + decision_kind.
    expect(dp.attributes).not.toHaveProperty('tenantId');
    // sanity-check the allowlist constants are actually in use.
    expect(KERNEL_METRIC_LABELS.turnTotal).toEqual(['surface', 'decision_kind']);
  });
});

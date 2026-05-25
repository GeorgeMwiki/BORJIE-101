/**
 * Unit tests for the agent-span instrumentation helpers.
 *
 * Wires an in-memory span exporter + an in-memory metric exporter so
 * each `withAgentSpan` / `recordDegraded` call produces a deterministic
 * trace + metric surface we can assert against — no live OTel
 * collector required.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  InMemoryMetricExporter,
  AggregationTemporality,
  type MetricData,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import { metrics, trace, SpanStatusCode } from '@opentelemetry/api';

import {
  withAgentSpan,
  recordDegraded,
  agentSpanName,
  __resetAgentMetricsHandleForTests,
} from '../agent-spans';

let spanExporter: InMemorySpanExporter;
let tracerProvider: NodeTracerProvider;

let metricExporter: InMemoryMetricExporter;
let metricReader: PeriodicExportingMetricReader;
let meterProvider: MeterProvider;

async function collect(): Promise<ResourceMetrics[]> {
  await metricReader.forceFlush();
  const data = metricExporter.getMetrics();
  metricExporter.reset();
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

function spansByName(spans: ReadableSpan[], name: string): ReadableSpan[] {
  return spans.filter((s) => s.name === name);
}

beforeEach(() => {
  // Trace setup — sdk-trace-base 2.x requires processors via constructor.
  spanExporter = new InMemorySpanExporter();
  tracerProvider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  });
  trace.setGlobalTracerProvider(tracerProvider);

  // Metric setup
  metricExporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
  metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60_000,
  });
  meterProvider = new MeterProvider({ readers: [metricReader] });
  metrics.setGlobalMeterProvider(meterProvider);

  __resetAgentMetricsHandleForTests();
});

afterEach(async () => {
  await tracerProvider.shutdown();
  spanExporter.reset();
  trace.disable();

  await metricReader.shutdown();
  await meterProvider.shutdown();
  metrics.disable();
  __resetAgentMetricsHandleForTests();
});

describe('agentSpanName', () => {
  it('formats the span name as agent.<name>.<operation>', () => {
    expect(agentSpanName('monthly-close', 'create')).toBe(
      'agent.monthly-close.create',
    );
    expect(agentSpanName('voice-agent', 'turn')).toBe('agent.voice-agent.turn');
  });
});

describe('withAgentSpan', () => {
  it('emits a span with the canonical name and agent attributes', async () => {
    const out = await withAgentSpan(
      'monthly-close',
      'create',
      async () => 'result-value',
      { tenantId: 'tnt-001' },
    );
    expect(out).toBe('result-value');

    const spans = spanExporter.getFinishedSpans();
    const span = spansByName(spans, 'agent.monthly-close.create')[0];
    expect(span).toBeDefined();
    expect(span!.attributes['agent.name']).toBe('monthly-close');
    expect(span!.attributes['agent.operation']).toBe('create');
    expect(span!.attributes['tenant_id']).toBe('tnt-001');
    expect(span!.status.code).toBe(SpanStatusCode.OK);
  });

  it('passes through custom attributes onto the span', async () => {
    await withAgentSpan(
      'voice-agent',
      'turn',
      async () => null,
      {
        tenantId: 'tnt-xyz',
        attributes: { sessionId: 'sess-42', languageCode: 'sw' },
      },
    );
    const span = spansByName(
      spanExporter.getFinishedSpans(),
      'agent.voice-agent.turn',
    )[0];
    expect(span).toBeDefined();
    expect(span!.attributes['sessionId']).toBe('sess-42');
    expect(span!.attributes['languageCode']).toBe('sw');
    expect(span!.attributes['tenant_id']).toBe('tnt-xyz');
  });

  it('records duration histogram + ok-count counter on success', async () => {
    await withAgentSpan('market-surveillance', 'scan', async () => {
      await new Promise((r) => setTimeout(r, 5));
      return 'ok';
    });

    const rms = await collect();
    const duration = findMetric(rms, 'agent.call.duration_ms');
    const total = findMetric(rms, 'agent.call.total');
    expect(duration).not.toBeNull();
    expect(total).not.toBeNull();
    expect(duration!.dataPoints.length).toBe(1);
    expect(total!.dataPoints.length).toBe(1);
    expect(total!.dataPoints[0].attributes.outcome).toBe('ok');
    expect(total!.dataPoints[0].attributes.agent).toBe('market-surveillance');
    expect(total!.dataPoints[0].attributes.operation).toBe('scan');
  });

  it('records exception, marks span ERROR, and bumps error counter on throw', async () => {
    const boom = new Error('predictive-interventions exploded');
    await expect(
      withAgentSpan('predictive-interventions', 'predict', async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    const span = spansByName(
      spanExporter.getFinishedSpans(),
      'agent.predictive-interventions.predict',
    )[0];
    expect(span).toBeDefined();
    expect(span!.status.code).toBe(SpanStatusCode.ERROR);
    expect(span!.events.some((e) => e.name === 'exception')).toBe(true);

    const rms = await collect();
    const errors = findMetric(rms, 'agent.call.errors_total');
    const total = findMetric(rms, 'agent.call.total');
    expect(errors).not.toBeNull();
    expect(errors!.dataPoints.length).toBe(1);
    expect(errors!.dataPoints[0].attributes.agent).toBe(
      'predictive-interventions',
    );
    // The total counter still records a call but tagged outcome=error.
    expect(total).not.toBeNull();
    expect(total!.dataPoints[0].attributes.outcome).toBe('error');
  });

  it('still records duration histogram even on the error path', async () => {
    await expect(
      withAgentSpan('voice-agent', 'turn', async () => {
        throw new Error('kernel.think failed');
      }),
    ).rejects.toThrow('kernel.think failed');

    const rms = await collect();
    const duration = findMetric(rms, 'agent.call.duration_ms');
    expect(duration).not.toBeNull();
    expect(duration!.dataPoints.length).toBe(1);
    expect(duration!.dataPoints[0].attributes.agent).toBe('voice-agent');
  });

  it('omits tenant_id attribute when context is empty', async () => {
    await withAgentSpan('monthly-close', 'list', async () => null);
    const span = spansByName(
      spanExporter.getFinishedSpans(),
      'agent.monthly-close.list',
    )[0];
    expect(span).toBeDefined();
    expect(span!.attributes['tenant_id']).toBeUndefined();
    expect(span!.attributes['agent.name']).toBe('monthly-close');
  });
});

describe('recordDegraded', () => {
  it('bumps the agent_port_degraded_total counter with port + reason labels', async () => {
    recordDegraded('monthly-close', 'autonomy', 'no_policy_repository_injected');
    recordDegraded('voice-agent', 'VoiceBrainPort', 'KERNEL_NOT_WIRED');

    const rms = await collect();
    const counter = findMetric(rms, 'agent_port_degraded_total');
    expect(counter).not.toBeNull();
    expect(counter!.dataPoints.length).toBe(2);
    const monthly = counter!.dataPoints.find(
      (p) => p.attributes.agent === 'monthly-close',
    );
    const voice = counter!.dataPoints.find(
      (p) => p.attributes.agent === 'voice-agent',
    );
    expect(monthly).toBeDefined();
    expect(monthly!.attributes.port).toBe('autonomy');
    expect(monthly!.attributes.reason).toBe('no_policy_repository_injected');
    expect(voice).toBeDefined();
    expect(voice!.attributes.port).toBe('VoiceBrainPort');
    expect(voice!.attributes.reason).toBe('KERNEL_NOT_WIRED');
  });

  it('aggregates repeated degradation events under the same labels', async () => {
    recordDegraded('market-surveillance', 'comparables', 'stub-not-configured');
    recordDegraded('market-surveillance', 'comparables', 'stub-not-configured');
    recordDegraded('market-surveillance', 'comparables', 'stub-not-configured');

    const rms = await collect();
    const counter = findMetric(rms, 'agent_port_degraded_total');
    expect(counter).not.toBeNull();
    expect(counter!.dataPoints.length).toBe(1);
    // DELTA temporality: each interval reports the increment since last collection.
    // We made 3 increments before the first collect, so the value is 3.
    const value = counter!.dataPoints[0].value;
    expect(value).toBe(3);
  });
});

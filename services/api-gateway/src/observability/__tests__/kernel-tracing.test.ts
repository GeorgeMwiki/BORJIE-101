/**
 * Unit tests for the kernel-tracing helpers.
 *
 * We register an in-process span exporter so each call produces a
 * deterministic trace surface we can assert against — no live OTel
 * collector required.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { trace } from '@opentelemetry/api';

import {
  withKernelSpan,
  withKernelStepSpan,
  KERNEL_TURN_SPAN_NAME,
  KERNEL_STEP_SPAN_NAMES,
  __internals,
  type KernelDecisionForSpan,
  type KernelTraceScope,
} from '../kernel-tracing';

let exporter: InMemorySpanExporter;
let provider: NodeTracerProvider;

const scope: KernelTraceScope = {
  tenantId: 'tnt-001',
  userId: 'user-abc',
  surface: 'tenant-app',
  tier: 'lease',
  stakes: 'medium',
  scopeKind: 'tenant',
};

const decision: KernelDecisionForSpan = {
  kind: 'answer',
  confidence: { overall: 0.82 },
  gates: {
    inviolable: { status: 'pass' },
    policy: { status: 'pass' },
    drift: { status: 'pass' },
  },
  provenance: {
    thoughtId: 'tho_real_123',
    sensorId: 'anthropic.claude-sonnet',
    modelId: 'claude-3-7-sonnet-20250219',
    latencyMs: 412,
    debateRoundsCompleted: 0,
  },
};

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  // sdk-trace-base 2.x removed `addSpanProcessor` + `register()` — the
  // processor list must be passed to the provider constructor and the
  // global registration is now done via the trace API directly.
  provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
});

afterEach(async () => {
  await provider.shutdown();
  exporter.reset();
  trace.disable();
});

function spansByName(spans: ReadableSpan[], name: string): ReadableSpan[] {
  return spans.filter((s) => s.name === name);
}

describe('withKernelSpan', () => {
  it('emits a span with the canonical name and Borjie attributes', async () => {
    const out = await withKernelSpan('tho_initial', scope, async () => decision);
    expect(out).toBe(decision);
    const spans = exporter.getFinishedSpans();
    const turn = spansByName(spans, KERNEL_TURN_SPAN_NAME)[0];
    expect(turn).toBeDefined();
    const attrs = turn!.attributes;
    expect(attrs['borjie.kernel.tenantId']).toBe('tnt-001');
    expect(attrs['borjie.kernel.surface']).toBe('tenant-app');
    expect(attrs['borjie.kernel.tier']).toBe('lease');
    expect(attrs['borjie.kernel.stakes']).toBe('medium');
    expect(attrs['borjie.kernel.scopeKind']).toBe('tenant');
    // userId should be hashed, not raw
    expect(attrs['borjie.kernel.userId']).not.toBe('user-abc');
    expect(typeof attrs['borjie.kernel.userId']).toBe('string');
    // thoughtId attribute should reflect the decision's canonical id
    expect(attrs['borjie.kernel.thoughtId']).toBe('tho_real_123');
    expect(attrs['borjie.kernel.decisionKind']).toBe('answer');
    expect(attrs['borjie.kernel.sensorId']).toBe('anthropic.claude-sonnet');
    expect(attrs['borjie.kernel.modelId']).toBe('claude-3-7-sonnet-20250219');
    expect(attrs['borjie.kernel.confidence.overall']).toBeCloseTo(0.82);
    expect(attrs['borjie.kernel.gates.policy.status']).toBe('pass');
    expect(attrs['borjie.kernel.gates.drift.status']).toBe('pass');
    expect(attrs['borjie.kernel.latencyMs']).toBe(412);
  });

  it('records sub-spans for each pipeline step name', async () => {
    await withKernelSpan('tho_a', scope, async () => {
      await withKernelStepSpan(KERNEL_STEP_SPAN_NAMES.cacheCheck, async () => null);
      await withKernelStepSpan(KERNEL_STEP_SPAN_NAMES.sensorCall, async () => null, {
        sensorId: 'anthropic.claude-haiku',
      });
      return decision;
    });
    const spans = exporter.getFinishedSpans();
    const cacheStep = spansByName(spans, 'kernel.step.cache_check')[0];
    const sensorStep = spansByName(spans, 'kernel.step.sensor_call')[0];
    expect(cacheStep).toBeDefined();
    expect(sensorStep).toBeDefined();
    expect(sensorStep!.attributes.sensorId).toBe('anthropic.claude-haiku');
  });

  it('records the exception and re-throws on the error path', async () => {
    const err = new Error('sensor exploded');
    await expect(
      withKernelSpan('tho_err', scope, async () => {
        throw err;
      }),
    ).rejects.toBe(err);
    const turn = spansByName(exporter.getFinishedSpans(), KERNEL_TURN_SPAN_NAME)[0];
    expect(turn).toBeDefined();
    // OTel SpanStatusCode.ERROR === 2
    expect(turn!.status.code).toBe(2);
    expect(turn!.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('records wall-clock latency on every span', async () => {
    await withKernelSpan('tho_lat', scope, async () => {
      // simulate some work
      await new Promise((r) => setTimeout(r, 5));
      return decision;
    });
    const turn = spansByName(exporter.getFinishedSpans(), KERNEL_TURN_SPAN_NAME)[0];
    const lat = turn!.attributes['borjie.kernel.wallLatencyMs'];
    expect(typeof lat).toBe('number');
    expect(lat as number).toBeGreaterThanOrEqual(0);
  });

  it('hashes the userId so raw identities never reach the trace', () => {
    const a = __internals.hashUserId('user-abc');
    const b = __internals.hashUserId('user-abc');
    const c = __internals.hashUserId(null);
    expect(a).toBe(b);
    expect(a).not.toBe('user-abc');
    expect(c).toBe('__nouser__');
  });
});

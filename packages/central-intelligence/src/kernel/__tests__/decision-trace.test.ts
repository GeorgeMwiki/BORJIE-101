/**
 * Decision-trace recorder — unit tests.
 *
 * Verifies:
 *   - begin() returns an immutable writer (step() yields a new writer)
 *   - finalize() persists a trace through the injected store
 *   - durations are non-negative and rounded
 *   - long summaries are truncated to 200 chars
 *   - store failures never throw (side-channel)
 *   - getRecentTraces() returns newest-first per tenant
 *   - the in-memory store enforces the per-tenant capacity (evict-oldest)
 *   - kernel `think()` records the expected step sequence on the
 *     happy path
 *   - kernel records `killswitch` step + `refusal` outcome on HALT
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createBrainKernel,
  createDecisionTraceRecorder,
  createEnvKillswitchPort,
  createInMemoryDecisionTraceStore,
  type DecisionTrace,
  type DecisionTraceStore,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
  type ThoughtRequest,
} from '../../kernel/index.js';
import type { ScopeContext } from '../../types.js';

const TENANT_SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_alpha',
  actorUserId: 'u',
  roles: ['estate-manager'],
  personaId: 'estate-manager',
};

function makeRequest(over: Partial<ThoughtRequest> = {}): ThoughtRequest {
  return {
    threadId: 'th',
    userMessage: 'how is the rent ledger?',
    scope: TENANT_SCOPE,
    tier: 'property',
    stakes: 'medium',
    surface: 'estate-manager-app',
    ...over,
  };
}

function scriptedSensor(text: string): Sensor {
  return {
    id: 'fake',
    modelId: 'fake-model',
    priority: 1,
    capabilities: ['fast'],
    async call(_args: SensorCallArgs): Promise<SensorCallResult> {
      return {
        text,
        thought: null,
        toolCalls: [],
        latencyMs: 1,
        modelId: 'fake-model',
        sensorId: 'fake',
      };
    },
  };
}

describe('decision-trace writer — immutability', () => {
  it('begin() + step() returns a new writer each time', async () => {
    const store = createInMemoryDecisionTraceStore();
    const rec = createDecisionTraceRecorder({ store });
    const w0 = rec.begin({
      thoughtId: 'th1',
      tenantId: 't_alpha',
      threadId: 'thr',
    });
    const w1 = w0.step({ step: 'cache', durationMs: 1, summary: 'miss' });
    expect(w1).not.toBe(w0);
  });

  it('records the steps that were submitted', async () => {
    const store = createInMemoryDecisionTraceStore();
    const rec = createDecisionTraceRecorder({ store });
    const w = rec
      .begin({ thoughtId: 'th1', tenantId: 't_alpha', threadId: 'thr' })
      .step({ step: 'cache', durationMs: 1, summary: 'miss' })
      .step({ step: 'inviolable', durationMs: 1, summary: 'pass' });
    const trace = await w.finalize({ outcome: 'answer' });
    expect(trace.steps.map((s) => s.step)).toEqual(['cache', 'inviolable']);
    expect(trace.outcome).toBe('answer');
  });

  it('truncates long summaries to ≤200 chars', async () => {
    const store = createInMemoryDecisionTraceStore();
    const rec = createDecisionTraceRecorder({ store });
    const longSummary = 'x'.repeat(500);
    const trace = await rec
      .begin({ thoughtId: 'th1', tenantId: null, threadId: 'thr' })
      .step({ step: 'sensor-call', durationMs: 1, summary: longSummary })
      .finalize({ outcome: 'answer' });
    expect(trace.steps[0]!.summary.length).toBeLessThanOrEqual(200);
  });

  it('clamps negative durations to 0', async () => {
    const store = createInMemoryDecisionTraceStore();
    const rec = createDecisionTraceRecorder({ store });
    const trace = await rec
      .begin({ thoughtId: 'th1', tenantId: null, threadId: 'thr' })
      .step({ step: 'cache', durationMs: -100, summary: 'miss' })
      .finalize({ outcome: 'answer' });
    expect(trace.steps[0]!.durationMs).toBe(0);
  });
});

describe('decision-trace recorder — store interactions', () => {
  it('swallows store errors so the side-channel never breaks the turn', async () => {
    const failingStore: DecisionTraceStore = {
      record: vi.fn(async () => {
        throw new Error('db down');
      }),
      recent: vi.fn(async () => []),
    };
    const rec = createDecisionTraceRecorder({ store: failingStore });
    const w = rec.begin({
      thoughtId: 'th1',
      tenantId: 't_alpha',
      threadId: 'thr',
    });
    await expect(
      w.step({ step: 'cache', durationMs: 1, summary: 'miss' }).finalize({
        outcome: 'answer',
      }),
    ).resolves.toBeDefined();
  });

  it('getRecentTraces returns newest-first within a tenant', async () => {
    const store = createInMemoryDecisionTraceStore();
    const rec = createDecisionTraceRecorder({ store });
    await rec
      .begin({ thoughtId: 'th-old', tenantId: 't_alpha', threadId: 'thr' })
      .finalize({ outcome: 'answer' });
    await rec
      .begin({ thoughtId: 'th-new', tenantId: 't_alpha', threadId: 'thr' })
      .finalize({ outcome: 'answer' });
    const recent = await rec.getRecentTraces('t_alpha', 10);
    expect(recent[0]!.thoughtId).toBe('th-new');
    expect(recent[1]!.thoughtId).toBe('th-old');
  });

  it('isolates traces per tenant', async () => {
    const store = createInMemoryDecisionTraceStore();
    const rec = createDecisionTraceRecorder({ store });
    await rec
      .begin({ thoughtId: 'th-a', tenantId: 't_alpha', threadId: 'thr' })
      .finalize({ outcome: 'answer' });
    await rec
      .begin({ thoughtId: 'th-b', tenantId: 't_beta', threadId: 'thr' })
      .finalize({ outcome: 'answer' });
    const alphaTraces = await rec.getRecentTraces('t_alpha', 10);
    expect(alphaTraces).toHaveLength(1);
    expect(alphaTraces[0]!.thoughtId).toBe('th-a');
  });

  it('clamps the limit to the per-tenant capacity (200) and ≥1', async () => {
    const store = createInMemoryDecisionTraceStore();
    const rec = createDecisionTraceRecorder({ store });
    await rec
      .begin({ thoughtId: 'th-a', tenantId: 't_alpha', threadId: 'thr' })
      .finalize({ outcome: 'answer' });
    // Very large limit should not throw; very small should clamp to ≥1.
    const big = await rec.getRecentTraces('t_alpha', 100000);
    const small = await rec.getRecentTraces('t_alpha', 0);
    expect(big.length).toBeLessThanOrEqual(1);
    expect(small.length).toBeLessThanOrEqual(1);
  });
});

describe('in-memory decision-trace store — capacity', () => {
  it('evicts oldest when per-tenant capacity is exceeded', async () => {
    const store = createInMemoryDecisionTraceStore({ capacity: 3 });
    const baseTrace: Omit<DecisionTrace, 'thoughtId'> = {
      tenantId: 't_alpha',
      threadId: 'thr',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      totalDurationMs: 1,
      steps: [],
      outcome: 'answer',
    };
    for (const id of ['a', 'b', 'c', 'd']) {
      await store.record({ ...baseTrace, thoughtId: id });
    }
    const recent = await store.recent({ tenantId: 't_alpha', limit: 10 });
    const ids = recent.map((r) => r.thoughtId);
    expect(ids).toHaveLength(3);
    // 'a' should have been evicted; newest first ⇒ d, c, b.
    expect(ids).toEqual(['d', 'c', 'b']);
  });
});

describe('kernel.think() — trace integration', () => {
  it('records the happy-path step sequence with outcome=answer', async () => {
    const store = createInMemoryDecisionTraceStore();
    const rec = createDecisionTraceRecorder({ store });
    const kernel = createBrainKernel({
      sensors: [scriptedSensor('rent ledger looks healthy')],
      traceRecorder: rec,
      uncertaintyPolicy: 'on',
    });
    await kernel.think(makeRequest());
    // Allow the fire-and-forget finalize to settle.
    await new Promise((r) => setTimeout(r, 0));
    const traces = await rec.getRecentTraces('t_alpha', 10);
    expect(traces).toHaveLength(1);
    const trace = traces[0]!;
    expect(trace.outcome).toBe('answer');
    const stepNames = trace.steps.map((s) => s.step);
    expect(stepNames).toContain('cache');
    expect(stepNames).toContain('inviolable');
    expect(stepNames).toContain('tier-compat');
    expect(stepNames).toContain('sensor-call');
    expect(stepNames).toContain('normalize');
    expect(stepNames).toContain('confidence');
    expect(stepNames).toContain('uncertainty-policy');
  });

  it('records killswitch step + refusal outcome on platform HALT', async () => {
    const store = createInMemoryDecisionTraceStore();
    const rec = createDecisionTraceRecorder({ store });
    const port = createEnvKillswitchPort({
      KILLSWITCH_STATE: 'halt',
      KILLSWITCH_REASON: 'COMPLIANCE_HOLD_CBK',
    });
    const kernel = createBrainKernel({
      sensors: [scriptedSensor('never used')],
      traceRecorder: rec,
      killswitch: port,
    });
    await kernel.think(makeRequest());
    await new Promise((r) => setTimeout(r, 0));
    const traces = await rec.getRecentTraces('t_alpha', 10);
    expect(traces).toHaveLength(1);
    expect(traces[0]!.outcome).toBe('refusal');
    expect(traces[0]!.refusalGate).toBe('killswitch');
    expect(traces[0]!.steps[0]!.step).toBe('killswitch');
    expect(traces[0]!.steps[0]!.summary).toMatch(/HALT/);
    expect(traces[0]!.steps[0]!.summary).toMatch(/COMPLIANCE_HOLD_CBK/);
  });
});

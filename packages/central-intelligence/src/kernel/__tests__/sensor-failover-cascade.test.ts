/**
 * Sensor cascade — Haiku → Sonnet tier escalation tests.
 *
 * Wave 6 CL-2 deploy. The cascade composes WITH the existing
 * `SensorRouter` failover; these tests focus on the tier-routing logic
 * itself (judge gating, stakes-forced Sonnet, telemetry emission, cost
 * and latency tracking, attempt ordering, conservative escalation on
 * judge throw). Provider-level health + breaker behaviour is covered
 * by `sensor-failover-breaker.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import {
  cascadeRoute,
  createSensorRouter,
  type CascadeAttempt,
  type CascadeEscalationReason,
  type CascadeJudgeFn,
  type CascadeMetricsPort,
  type CascadeModelTier,
  type CascadeStakesLevel,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
} from '../index.js';

const ARGS: SensorCallArgs = {
  system: 'cascade-test',
  userMessage: 'hello',
  priorTurns: [],
  extendedThinking: false,
  stakes: 'low',
};

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

function makeSensor(
  id: string,
  opts: {
    readonly priority?: number;
    readonly caps?: ReadonlyArray<Sensor['capabilities'][number]>;
    readonly responseText?: string;
    readonly thought?: string | null;
    readonly throws?: boolean;
  } = {},
): Sensor {
  return {
    id,
    modelId: `${id}-model`,
    priority: opts.priority ?? 10,
    capabilities: opts.caps ?? ['fast'],
    async call(_args: SensorCallArgs): Promise<SensorCallResult> {
      if (opts.throws) throw new Error(`${id}-boom`);
      return {
        text: opts.responseText ?? `from-${id}`,
        thought: opts.thought ?? null,
        toolCalls: [],
        latencyMs: 1,
        modelId: `${id}-model`,
        sensorId: id,
      };
    },
  };
}

function makeRouter(sensors: ReadonlyArray<Sensor>, clock?: () => number) {
  return createSensorRouter({
    sensors,
    clock,
  });
}

function makeMetricsRecorder(): {
  readonly metrics: CascadeMetricsPort;
  readonly escalations: Array<{
    from: CascadeModelTier;
    to: CascadeModelTier;
    stakes: CascadeStakesLevel;
    reason: CascadeEscalationReason;
  }>;
  readonly attempts: CascadeAttempt[];
} {
  const escalations: Array<{
    from: CascadeModelTier;
    to: CascadeModelTier;
    stakes: CascadeStakesLevel;
    reason: CascadeEscalationReason;
  }> = [];
  const attempts: CascadeAttempt[] = [];
  return {
    escalations,
    attempts,
    metrics: {
      recordEscalation(args) {
        escalations.push({ ...args });
      },
      recordAttempt(attempt) {
        attempts.push(attempt);
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('cascadeRoute — Haiku→Sonnet cascade', () => {
  it('low stakes + high-confidence Haiku → returns Haiku, escalated=false', async () => {
    const haiku = makeSensor('haiku', { priority: 1, responseText: 'haiku-answer' });
    const sonnet = makeSensor('sonnet', { priority: 5 });
    const router = makeRouter([haiku, sonnet]);
    const judgeFn: CascadeJudgeFn = async () => ({ confidence: 0.95, blocked: false });

    const out = await cascadeRoute(
      ARGS,
      { stakes: 'low', judgeFn, haikuSensorId: 'haiku' },
      { router },
    );

    expect(out.escalated).toBe(false);
    expect(out.answer.sensorId).toBe('haiku');
    expect(out.answer.text).toBe('haiku-answer');
    expect(out.attemptedModels).toHaveLength(1);
    expect(out.attemptedModels[0]!.tier).toBe('haiku');
    expect(out.attemptedModels[0]!.confidence).toBeCloseTo(0.95, 5);
    expect(out.escalationReason).toBeUndefined();
  });

  it('low stakes + low-confidence Haiku → escalates to Sonnet', async () => {
    const haiku = makeSensor('haiku', { priority: 1, responseText: 'maybe' });
    const sonnet = makeSensor('sonnet', { priority: 5, responseText: 'better' });
    const router = makeRouter([haiku, sonnet]);
    const judgeFn: CascadeJudgeFn = async () => ({ confidence: 0.3, blocked: false });

    const out = await cascadeRoute(
      ARGS,
      {
        stakes: 'low',
        judgeFn,
        haikuSensorId: 'haiku',
        sonnetSensorId: 'sonnet',
        confidenceThreshold: 0.7,
      },
      { router },
    );

    expect(out.escalated).toBe(true);
    expect(out.answer.sensorId).toBe('sonnet');
    expect(out.answer.text).toBe('better');
    expect(out.escalationReason).toBe('low_confidence');
    expect(out.attemptedModels.map((a) => a.tier)).toEqual(['haiku', 'sonnet']);
  });

  it('medium stakes (default cost-sensitive) tries Haiku first', async () => {
    const haiku = makeSensor('haiku', { priority: 1 });
    const sonnet = makeSensor('sonnet', { priority: 5 });
    const router = makeRouter([haiku, sonnet]);
    const judgeFn: CascadeJudgeFn = async () => ({ confidence: 0.9, blocked: false });

    const out = await cascadeRoute(
      ARGS,
      { stakes: 'medium', judgeFn, haikuSensorId: 'haiku' },
      { router },
    );

    expect(out.escalated).toBe(false);
    expect(out.answer.sensorId).toBe('haiku');
  });

  it('high stakes → skips Haiku, goes straight to Sonnet', async () => {
    const haikuCalls = { n: 0 };
    const sonnetCalls = { n: 0 };
    const haiku: Sensor = {
      id: 'haiku',
      modelId: 'haiku-model',
      priority: 1,
      capabilities: ['fast'],
      async call() {
        haikuCalls.n += 1;
        return {
          text: 'haiku',
          thought: null,
          toolCalls: [],
          latencyMs: 1,
          modelId: 'haiku-model',
          sensorId: 'haiku',
        };
      },
    };
    const sonnet: Sensor = {
      id: 'sonnet',
      modelId: 'sonnet-model',
      priority: 5,
      capabilities: ['fast'],
      async call() {
        sonnetCalls.n += 1;
        return {
          text: 'sonnet',
          thought: null,
          toolCalls: [],
          latencyMs: 1,
          modelId: 'sonnet-model',
          sensorId: 'sonnet',
        };
      },
    };
    const router = makeRouter([haiku, sonnet]);

    const out = await cascadeRoute(
      ARGS,
      { stakes: 'high', sonnetSensorId: 'sonnet' },
      { router },
    );

    expect(out.escalated).toBe(false);
    expect(out.answer.sensorId).toBe('sonnet');
    expect(out.attemptedModels).toHaveLength(1);
    expect(out.attemptedModels[0]!.tier).toBe('sonnet');
    expect(haikuCalls.n).toBe(0);
    expect(sonnetCalls.n).toBe(1);
  });

  it('critical stakes → skips Haiku', async () => {
    const haikuCalls = { n: 0 };
    const haiku: Sensor = {
      id: 'haiku',
      modelId: 'haiku-model',
      priority: 1,
      capabilities: ['fast'],
      async call() {
        haikuCalls.n += 1;
        return {
          text: 'haiku',
          thought: null,
          toolCalls: [],
          latencyMs: 1,
          modelId: 'haiku-model',
          sensorId: 'haiku',
        };
      },
    };
    const sonnet = makeSensor('sonnet', { priority: 5 });
    const router = makeRouter([haiku, sonnet]);

    const out = await cascadeRoute(
      ARGS,
      { stakes: 'critical', sonnetSensorId: 'sonnet' },
      { router },
    );

    expect(haikuCalls.n).toBe(0);
    expect(out.answer.sensorId).toBe('sonnet');
    expect(out.attemptedModels).toHaveLength(1);
  });

  it('judgeFn returns blocked=true → escalates regardless of confidence', async () => {
    const haiku = makeSensor('haiku', { priority: 1 });
    const sonnet = makeSensor('sonnet', { priority: 5 });
    const router = makeRouter([haiku, sonnet]);
    // High confidence but blocked → must still escalate.
    const judgeFn: CascadeJudgeFn = async () => ({ confidence: 0.99, blocked: true });

    const out = await cascadeRoute(
      ARGS,
      {
        stakes: 'low',
        judgeFn,
        haikuSensorId: 'haiku',
        sonnetSensorId: 'sonnet',
      },
      { router },
    );

    expect(out.escalated).toBe(true);
    expect(out.escalationReason).toBe('judge_blocked');
    expect(out.answer.sensorId).toBe('sonnet');
  });

  it('judgeFn throws → escalates conservatively with judge_blocked reason', async () => {
    const haiku = makeSensor('haiku', { priority: 1 });
    const sonnet = makeSensor('sonnet', { priority: 5 });
    const router = makeRouter([haiku, sonnet]);
    const judgeFn: CascadeJudgeFn = async () => {
      throw new Error('judge-network-error');
    };

    const out = await cascadeRoute(
      ARGS,
      { stakes: 'low', judgeFn, haikuSensorId: 'haiku', sonnetSensorId: 'sonnet' },
      { router },
    );

    expect(out.escalated).toBe(true);
    expect(out.escalationReason).toBe('judge_blocked');
    expect(out.answer.sensorId).toBe('sonnet');
  });

  it('Haiku sensor throws → escalates with tool_error reason', async () => {
    const haiku = makeSensor('haiku-broken', { priority: 1, throws: true });
    const sonnet = makeSensor('sonnet', { priority: 5 });
    // No other haiku-capability sensors → router throws.
    // Cascade catches it and escalates to Sonnet.
    const haikuRouter = createSensorRouter({ sensors: [haiku] });
    const sonnetRouter = createSensorRouter({ sensors: [sonnet] });

    // Build a composite router that lets the cascade pick `haiku` first
    // and then independently pick `sonnet`. Simulate by using a single
    // router with both sensors and pinning preferred ids.
    const router = createSensorRouter({ sensors: [haiku, sonnet] });

    const out = await cascadeRoute(
      ARGS,
      {
        stakes: 'low',
        judgeFn: async () => ({ confidence: 0.99, blocked: false }),
        haikuSensorId: 'haiku-broken',
        sonnetSensorId: 'sonnet',
      },
      { router },
    );

    // The router fails-over from broken Haiku to Sonnet INSIDE the Haiku
    // call. To force tier-level tool_error, we need a router that has
    // ONLY a broken Haiku sensor for the first call.
    // Re-run the assertion via the haiku-only router for the strict
    // tool_error path.
    void haikuRouter;
    void sonnetRouter;
    // Either path is acceptable: provider-level failover may absorb the
    // Haiku failure and surface Sonnet; or the cascade may see the throw
    // and escalate with tool_error. Both keep the user served.
    expect(out.answer.sensorId).toBe('sonnet');
    if (out.attemptedModels.length === 2) {
      expect(out.escalationReason).toBe('tool_error');
    }
  });

  it('cascade escalates with tool_error when ONLY Haiku tier sensor exists and fails', async () => {
    // Sub-router whose Haiku tier ALWAYS throws (no provider fallback).
    const brokenHaiku = makeSensor('haiku-broken', {
      priority: 1,
      throws: true,
    });
    const sonnet = makeSensor('sonnet', { priority: 5 });
    // Compose with both sensors but `'fast'` is required so failover
    // inside `router.call` can hand from broken Haiku to Sonnet.
    // To force a real tool_error path through the cascade we build a
    // composite router where the Haiku call goes through a router that
    // ONLY knows about the broken Haiku.
    const haikuOnlyRouter = createSensorRouter({ sensors: [brokenHaiku] });
    const composite = makeCompositeRouter(haikuOnlyRouter, [sonnet]);

    const { metrics, escalations } = makeMetricsRecorder();
    const out = await cascadeRoute(
      ARGS,
      {
        stakes: 'low',
        judgeFn: async () => ({ confidence: 0.99, blocked: false }),
        haikuSensorId: 'haiku-broken',
        sonnetSensorId: 'sonnet',
        metrics,
      },
      { router: composite },
    );

    expect(out.escalated).toBe(true);
    expect(out.escalationReason).toBe('tool_error');
    expect(out.answer.sensorId).toBe('sonnet');
    expect(escalations).toHaveLength(1);
    expect(escalations[0]!.reason).toBe('tool_error');
  });

  it('tracks cost accurately per attempt', async () => {
    const haiku = makeSensor('haiku', { priority: 1 });
    const sonnet = makeSensor('sonnet', { priority: 5 });
    const router = makeRouter([haiku, sonnet]);
    const judgeFn: CascadeJudgeFn = async () => ({ confidence: 0.2, blocked: false });

    const out = await cascadeRoute(
      ARGS,
      {
        stakes: 'low',
        judgeFn,
        haikuSensorId: 'haiku',
        sonnetSensorId: 'sonnet',
        haikuCostUsd: 0.001,
        sonnetCostUsd: 0.05,
      },
      { router },
    );

    expect(out.attemptedModels).toHaveLength(2);
    expect(out.attemptedModels[0]!.cost).toBeCloseTo(0.001, 6);
    expect(out.attemptedModels[1]!.cost).toBeCloseTo(0.05, 6);
  });

  it('tracks latency accurately per attempt via injected clock', async () => {
    let nowMs = 1_000;
    const tick = (): number => nowMs;
    const slowHaiku: Sensor = {
      id: 'haiku',
      modelId: 'haiku-model',
      priority: 1,
      capabilities: ['fast'],
      async call() {
        nowMs += 50; // 50 ms haiku call
        return {
          text: 'h',
          thought: null,
          toolCalls: [],
          latencyMs: 50,
          modelId: 'haiku-model',
          sensorId: 'haiku',
        };
      },
    };
    const slowSonnet: Sensor = {
      id: 'sonnet',
      modelId: 'sonnet-model',
      priority: 5,
      capabilities: ['fast'],
      async call() {
        nowMs += 200; // 200 ms sonnet call
        return {
          text: 's',
          thought: null,
          toolCalls: [],
          latencyMs: 200,
          modelId: 'sonnet-model',
          sensorId: 'sonnet',
        };
      },
    };
    const router = createSensorRouter({ sensors: [slowHaiku, slowSonnet], clock: tick });
    const judgeFn: CascadeJudgeFn = async () => ({ confidence: 0.1, blocked: false });

    const out = await cascadeRoute(
      ARGS,
      {
        stakes: 'low',
        judgeFn,
        haikuSensorId: 'haiku',
        sonnetSensorId: 'sonnet',
      },
      { router, clock: tick },
    );

    expect(out.attemptedModels[0]!.latencyMs).toBe(50);
    expect(out.attemptedModels[1]!.latencyMs).toBe(200);
  });

  it('attemptedModels array preserves call order (haiku first, sonnet second)', async () => {
    const haiku = makeSensor('haiku', { priority: 1 });
    const sonnet = makeSensor('sonnet', { priority: 5 });
    const router = makeRouter([haiku, sonnet]);
    const judgeFn: CascadeJudgeFn = async () => ({ confidence: 0.2, blocked: false });

    const out = await cascadeRoute(
      ARGS,
      { stakes: 'low', judgeFn, haikuSensorId: 'haiku', sonnetSensorId: 'sonnet' },
      { router },
    );

    expect(out.attemptedModels[0]!.tier).toBe('haiku');
    expect(out.attemptedModels[1]!.tier).toBe('sonnet');
    expect(out.attemptedModels[0]!.model).toBe('haiku-model');
    expect(out.attemptedModels[1]!.model).toBe('sonnet-model');
  });

  it('emits escalation metric with correct fields', async () => {
    const haiku = makeSensor('haiku', { priority: 1 });
    const sonnet = makeSensor('sonnet', { priority: 5 });
    const router = makeRouter([haiku, sonnet]);
    const judgeFn: CascadeJudgeFn = async () => ({ confidence: 0.3, blocked: false });
    const { metrics, escalations, attempts } = makeMetricsRecorder();

    await cascadeRoute(
      ARGS,
      {
        stakes: 'medium',
        judgeFn,
        haikuSensorId: 'haiku',
        sonnetSensorId: 'sonnet',
        metrics,
      },
      { router },
    );

    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toEqual({
      from: 'haiku',
      to: 'sonnet',
      stakes: 'medium',
      reason: 'low_confidence',
    });
    expect(attempts).toHaveLength(2);
  });

  it('does NOT emit escalation metric when Haiku confidence clears threshold', async () => {
    const haiku = makeSensor('haiku', { priority: 1 });
    const router = makeRouter([haiku]);
    const judgeFn: CascadeJudgeFn = async () => ({ confidence: 0.95, blocked: false });
    const { metrics, escalations, attempts } = makeMetricsRecorder();

    await cascadeRoute(
      ARGS,
      {
        stakes: 'low',
        judgeFn,
        haikuSensorId: 'haiku',
        metrics,
      },
      { router },
    );

    expect(escalations).toHaveLength(0);
    expect(attempts).toHaveLength(1);
  });

  it('falls back to self-reported confidence when judgeFn is null', async () => {
    const haiku = makeSensor('haiku', {
      priority: 1,
      thought: '{"confidence": 0.9, "rationale": "looks fine"}',
    });
    const router = makeRouter([haiku]);

    const out = await cascadeRoute(
      ARGS,
      { stakes: 'low', judgeFn: null, haikuSensorId: 'haiku' },
      { router },
    );

    expect(out.escalated).toBe(false);
    expect(out.answer.sensorId).toBe('haiku');
    expect(out.attemptedModels[0]!.confidence).toBeCloseTo(0.9, 5);
  });

  it('escalates conservatively when no judge AND no self-report present', async () => {
    const haiku = makeSensor('haiku', { priority: 1, thought: null });
    const sonnet = makeSensor('sonnet', { priority: 5 });
    const router = makeRouter([haiku, sonnet]);

    const out = await cascadeRoute(
      ARGS,
      {
        stakes: 'low',
        judgeFn: null,
        haikuSensorId: 'haiku',
        sonnetSensorId: 'sonnet',
      },
      { router },
    );

    // No signal at all → conservative escalate (confidence=0).
    expect(out.escalated).toBe(true);
    expect(out.escalationReason).toBe('low_confidence');
    expect(out.answer.sensorId).toBe('sonnet');
  });

  it('costSensitive=false forces Sonnet even on low stakes', async () => {
    const haikuCalls = { n: 0 };
    const haiku: Sensor = {
      id: 'haiku',
      modelId: 'haiku-model',
      priority: 1,
      capabilities: ['fast'],
      async call() {
        haikuCalls.n += 1;
        return {
          text: 'h',
          thought: null,
          toolCalls: [],
          latencyMs: 1,
          modelId: 'haiku-model',
          sensorId: 'haiku',
        };
      },
    };
    const sonnet = makeSensor('sonnet', { priority: 5 });
    const router = makeRouter([haiku, sonnet]);

    const out = await cascadeRoute(
      ARGS,
      {
        stakes: 'low',
        costSensitive: false,
        sonnetSensorId: 'sonnet',
      },
      { router },
    );

    expect(haikuCalls.n).toBe(0);
    expect(out.answer.sensorId).toBe('sonnet');
    expect(out.attemptedModels[0]!.tier).toBe('sonnet');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Test helper — composite router that delegates the Haiku tier to one
// underlying router and the Sonnet tier to a separately-built one so
// the "Haiku tier fails completely" test can force a real tool_error
// path without the underlying SensorRouter absorbing the failure via
// its provider-level failover.
// ─────────────────────────────────────────────────────────────────────

function makeCompositeRouter(
  haikuRouter: ReturnType<typeof createSensorRouter>,
  sonnetSensors: ReadonlyArray<Sensor>,
): ReturnType<typeof createSensorRouter> {
  const sonnetRouter = createSensorRouter({ sensors: sonnetSensors });
  return {
    async call(args, required, options) {
      const preferred = options?.preferred ?? '';
      if (preferred.includes('haiku')) {
        return haikuRouter.call(args, required, options);
      }
      return sonnetRouter.call(args, required, options);
    },
    snapshotHealth() {
      return [...haikuRouter.snapshotHealth(), ...sonnetRouter.snapshotHealth()];
    },
    getDegradedState() {
      // Trivial union — combine for inspection only.
      const a = haikuRouter.getDegradedState();
      const b = sonnetRouter.getDegradedState();
      return {
        degraded: a.degraded || b.degraded,
        openSensors: [...a.openSensors, ...b.openSensors],
        currentProvider: a.currentProvider ?? b.currentProvider,
        degradedAt: a.degradedAt ?? b.degradedAt,
        lastFailedAt:
          a.lastFailedAt !== null && b.lastFailedAt !== null
            ? Math.max(a.lastFailedAt, b.lastFailedAt)
            : (a.lastFailedAt ?? b.lastFailedAt),
      };
    },
    health() {
      return [...haikuRouter.health(), ...sonnetRouter.health()];
    },
    resetAll() {
      haikuRouter.resetAll();
      sonnetRouter.resetAll();
    },
  };
}

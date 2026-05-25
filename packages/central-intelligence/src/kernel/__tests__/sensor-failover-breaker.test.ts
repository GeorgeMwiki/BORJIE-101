/**
 * Sensor failover — rolling-window + 3-strike circuit breaker tests.
 *
 * LITFIN-parity coverage of the breaker FSM, snapshotHealth shape, and
 * preferred-sensor pin. The existing baseline coverage lives in
 * `src/__tests__/sensor-failover.test.ts` (kept for behaviour
 * regression on the simple "1-strike + cooldown" mode); this file
 * exercises the new default semantics.
 */

import { describe, it, expect } from 'vitest';
import {
  createSensorRouter,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
} from '../index.js';

const ARGS: SensorCallArgs = {
  system: 'test-system',
  userMessage: 'hello',
  priorTurns: [],
  extendedThinking: false,
  stakes: 'low',
};

function failingSensor(id: string, priority = 10): Sensor {
  return {
    id,
    modelId: `${id}-m`,
    priority,
    capabilities: ['fast'],
    async call(): Promise<SensorCallResult> {
      throw new Error(`${id}-boom`);
    },
  };
}

function okSensor(id: string, priority = 10): Sensor {
  return {
    id,
    modelId: `${id}-m`,
    priority,
    capabilities: ['fast'],
    async call(): Promise<SensorCallResult> {
      return {
        text: `from-${id}`,
        thought: null,
        toolCalls: [],
        latencyMs: 1,
        modelId: `${id}-m`,
        sensorId: id,
      };
    },
  };
}

describe('sensor breaker — 3-strike default', () => {
  it('does NOT open the breaker on a single failure', async () => {
    let now = 0;
    const router = createSensorRouter({
      sensors: [failingSensor('flaky', 1), okSensor('stable', 5)],
      coolDownMs: 1_000,
      clock: () => now,
    });
    await router.call(ARGS, ['fast']);
    const flaky = router.snapshotHealth().find((s) => s.id === 'flaky');
    expect(flaky?.breakerState).toBe('closed');
    expect(flaky?.consecutiveFailures).toBe(1);
  });

  it('opens the breaker after 3 consecutive failures', async () => {
    let now = 0;
    const router = createSensorRouter({
      sensors: [failingSensor('flaky', 1), okSensor('stable', 5)],
      coolDownMs: 10_000,
      clock: () => now,
    });
    for (let i = 0; i < 3; i++) {
      await router.call(ARGS, ['fast']);
      now += 100;
    }
    const flaky = router.snapshotHealth().find((s) => s.id === 'flaky');
    expect(flaky?.breakerState).toBe('open');
    expect(flaky?.consecutiveFailures).toBe(3);
    expect(flaky?.cooldownRemainingMs).toBeGreaterThan(0);
  });

  it('moves to half-open after cooldown elapses', async () => {
    let now = 0;
    const router = createSensorRouter({
      sensors: [failingSensor('flaky', 1), okSensor('stable', 5)],
      coolDownMs: 1_000,
      clock: () => now,
    });
    for (let i = 0; i < 3; i++) {
      await router.call(ARGS, ['fast']);
      now += 10;
    }
    now += 2_000;
    const flaky = router.snapshotHealth().find((s) => s.id === 'flaky');
    expect(flaky?.breakerState).toBe('half-open');
    expect(flaky?.cooldownRemainingMs).toBe(0);
  });

  it('half-open probe success closes the breaker', async () => {
    let now = 0;
    let mode: 'fail' | 'ok' = 'fail';
    const flipper: Sensor = {
      id: 'flipper',
      modelId: 'flipper-m',
      priority: 1,
      capabilities: ['fast'],
      async call(): Promise<SensorCallResult> {
        if (mode === 'fail') throw new Error('boom');
        return {
          text: 'recovered',
          thought: null,
          toolCalls: [],
          latencyMs: 1,
          modelId: 'flipper-m',
          sensorId: 'flipper',
        };
      },
    };
    const router = createSensorRouter({
      sensors: [flipper, okSensor('stable', 5)],
      coolDownMs: 1_000,
      clock: () => now,
    });
    for (let i = 0; i < 3; i++) {
      await router.call(ARGS, ['fast']);
      now += 10;
    }
    now += 2_000;
    mode = 'ok';
    await router.call(ARGS, ['fast']); // probe should now succeed
    const snap = router.snapshotHealth().find((s) => s.id === 'flipper');
    expect(snap?.breakerState).toBe('closed');
    expect(snap?.consecutiveFailures).toBe(0);
  });

  it('half-open probe failure re-opens the breaker', async () => {
    let now = 0;
    const router = createSensorRouter({
      sensors: [failingSensor('flaky', 1), okSensor('stable', 5)],
      coolDownMs: 1_000,
      clock: () => now,
    });
    for (let i = 0; i < 3; i++) {
      await router.call(ARGS, ['fast']);
      now += 10;
    }
    now += 2_000;
    const beforeProbe = router.snapshotHealth().find((s) => s.id === 'flaky');
    expect(beforeProbe?.breakerState).toBe('half-open');
    await router.call(ARGS, ['fast']); // probe still fails
    const afterProbe = router.snapshotHealth().find((s) => s.id === 'flaky');
    expect(afterProbe?.breakerState).toBe('open');
  });

  it('snapshotHealth returns all 5 required fields per sensor', () => {
    const router = createSensorRouter({
      sensors: [okSensor('a', 1), okSensor('b', 2)],
    });
    const snap = router.snapshotHealth();
    expect(snap).toHaveLength(2);
    for (const s of snap) {
      expect(s).toHaveProperty('id');
      expect(s).toHaveProperty('successCount');
      expect(s).toHaveProperty('failureCount');
      expect(s).toHaveProperty('breakerState');
      expect(s).toHaveProperty('successRate');
      expect(s).toHaveProperty('cooldownRemainingMs');
    }
  });

  it('rolling 60s window drops successes older than the window', async () => {
    let now = 0;
    const router = createSensorRouter({
      sensors: [okSensor('a', 1)],
      healthWindowMs: 1_000,
      clock: () => now,
    });
    await router.call(ARGS, ['fast']);
    expect(router.snapshotHealth()[0]?.successCount).toBe(1);
    now += 2_000;
    expect(router.snapshotHealth()[0]?.successCount).toBe(0);
  });

  it('preferred sensor is tried first when its breaker is closed', async () => {
    const router = createSensorRouter({
      sensors: [okSensor('a', 1), okSensor('b', 5)],
    });
    const out = await router.call(ARGS, ['fast'], { preferred: 'b' });
    expect(out.sensorId).toBe('b');
  });

  it('snapshotHealth reflects success rate after mixed results', async () => {
    let now = 0;
    let fail = true;
    const flipper: Sensor = {
      id: 'flipper',
      modelId: 'flipper-m',
      priority: 1,
      capabilities: ['fast'],
      async call(): Promise<SensorCallResult> {
        if (fail) throw new Error('boom');
        return {
          text: 'ok',
          thought: null,
          toolCalls: [],
          latencyMs: 1,
          modelId: 'flipper-m',
          sensorId: 'flipper',
        };
      },
    };
    const router = createSensorRouter({
      sensors: [flipper, okSensor('backup', 5)],
      clock: () => now,
    });
    await router.call(ARGS, ['fast']);
    now += 1;
    fail = false;
    await router.call(ARGS, ['fast']);
    const snap = router.snapshotHealth().find((s) => s.id === 'flipper');
    expect(snap?.successCount).toBe(1);
    expect(snap?.failureCount).toBe(1);
    expect(snap?.successRate).toBeCloseTo(0.5, 5);
  });

  it('falls back to cooled-down sensors rather than refusing service', async () => {
    let now = 0;
    const router = createSensorRouter({
      sensors: [failingSensor('a', 1), failingSensor('b', 2)],
      coolDownMs: 10_000,
      breakerThreshold: 1,
      clock: () => now,
    });
    // Trip both breakers.
    await expect(router.call(ARGS, ['fast'])).rejects.toThrow();
    const before = router.snapshotHealth();
    expect(before.every((s) => s.breakerState === 'open')).toBe(true);
    // Even with both open, a call must still ATTEMPT them (degraded mode).
    await expect(router.call(ARGS, ['fast'])).rejects.toThrow();
  });
});

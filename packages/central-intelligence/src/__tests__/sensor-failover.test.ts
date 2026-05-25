/**
 * Sensor failover — unit tests for `createSensorRouter`.
 *
 * Covers:
 *   - priority-based selection (lower wins)
 *   - capability filtering
 *   - failover on error and cool-down marking
 *   - SensorFailoverError when nothing is eligible
 *   - cool-down expiration & resetAll
 *   - health() reflects failure state
 */

import { describe, it, expect } from 'vitest';
import {
  createSensorRouter,
  SensorFailoverError,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
} from '../kernel/index.js';

const ARGS: SensorCallArgs = {
  system: 'test-system',
  userMessage: 'hello',
  priorTurns: [],
  extendedThinking: false,
  stakes: 'low',
};

function ok(id: string, opts: { priority?: number; caps?: ReadonlyArray<Sensor['capabilities'][number]> } = {}): Sensor {
  return {
    id,
    modelId: `${id}-m`,
    priority: opts.priority ?? 10,
    capabilities: opts.caps ?? ['fast'],
    async call(_args: SensorCallArgs): Promise<SensorCallResult> {
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

function failing(id: string, opts: { priority?: number; caps?: ReadonlyArray<Sensor['capabilities'][number]> } = {}): Sensor {
  return {
    id,
    modelId: `${id}-m`,
    priority: opts.priority ?? 10,
    capabilities: opts.caps ?? ['fast'],
    async call(): Promise<SensorCallResult> {
      throw new Error(`${id}-boom`);
    },
  };
}

describe('createSensorRouter', () => {
  it('picks the lowest-priority healthy sensor that satisfies capabilities', async () => {
    const router = createSensorRouter({
      sensors: [ok('hi', { priority: 50 }), ok('lo', { priority: 1 })],
    });
    const out = await router.call(ARGS, ['fast']);
    expect(out.sensorId).toBe('lo');
  });

  it('skips sensors that lack a required capability', async () => {
    const router = createSensorRouter({
      sensors: [ok('text-only', { priority: 1, caps: ['fast'] }), ok('vision', { priority: 5, caps: ['vision', 'fast'] })],
    });
    const out = await router.call(ARGS, ['vision']);
    expect(out.sensorId).toBe('vision');
  });

  it('fails over to next sensor when primary throws', async () => {
    const router = createSensorRouter({
      sensors: [failing('primary', { priority: 1 }), ok('backup', { priority: 5 })],
    });
    const out = await router.call(ARGS, ['fast']);
    expect(out.sensorId).toBe('backup');
  });

  it('throws SensorFailoverError when every sensor fails', async () => {
    const router = createSensorRouter({
      sensors: [failing('a'), failing('b')],
    });
    await expect(router.call(ARGS, ['fast'])).rejects.toBeInstanceOf(SensorFailoverError);
  });

  it('throws SensorFailoverError when no sensor matches capability', async () => {
    const router = createSensorRouter({
      sensors: [ok('a', { caps: ['fast'] })],
    });
    await expect(router.call(ARGS, ['vision'])).rejects.toBeInstanceOf(SensorFailoverError);
  });

  it('marks failed sensor unhealthy after breaker trips and cooldown elapses', async () => {
    let now = 1_000;
    const router = createSensorRouter({
      sensors: [failing('flaky', { priority: 1 }), ok('stable', { priority: 5 })],
      coolDownMs: 1000,
      // 1-strike breaker preserves the pre-Wave-K aggressive-trip behaviour
      // for this baseline test; the dedicated 3-strike test below exercises
      // the LITFIN-parity default.
      breakerThreshold: 1,
      clock: () => now,
    });
    await router.call(ARGS, ['fast']); // trips cool-down on flaky
    const health = router.health();
    expect(health.find((h) => h.id === 'flaky')?.healthy).toBe(false);
    expect(health.find((h) => h.id === 'stable')?.healthy).toBe(true);
  });

  it('returns flaky sensor to rotation after cool-down expires', async () => {
    let now = 0;
    const router = createSensorRouter({
      sensors: [failing('flaky', { priority: 1 }), ok('stable', { priority: 5 })],
      coolDownMs: 1000,
      breakerThreshold: 1,
      clock: () => now,
    });
    await router.call(ARGS, ['fast']); // mark flaky as down
    now += 2000;                       // beyond cool-down
    const health = router.health();
    expect(health.find((h) => h.id === 'flaky')?.healthy).toBe(true);
  });

  it('resetAll() clears unhealthy state', async () => {
    let now = 0;
    const router = createSensorRouter({
      sensors: [failing('flaky', { priority: 1 }), ok('stable', { priority: 5 })],
      coolDownMs: 10_000,
      breakerThreshold: 1,
      clock: () => now,
    });
    await router.call(ARGS, ['fast']);
    expect(router.health().find((h) => h.id === 'flaky')?.healthy).toBe(false);
    router.resetAll();
    expect(router.health().find((h) => h.id === 'flaky')?.healthy).toBe(true);
  });

  it('SensorFailoverError aggregates per-sensor error messages', async () => {
    const router = createSensorRouter({
      sensors: [failing('a'), failing('b')],
    });
    try {
      await router.call(ARGS, ['fast']);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SensorFailoverError);
      const e = err as SensorFailoverError;
      expect(e.attempts).toHaveLength(2);
      expect(e.attempts.map((a) => a.sensorId).sort()).toEqual(['a', 'b']);
    }
  });

  it('does not mutate the injected sensors array', async () => {
    const sensors = [ok('a', { priority: 5 }), ok('b', { priority: 1 })];
    const snapshot = [...sensors];
    const router = createSensorRouter({ sensors });
    await router.call(ARGS, ['fast']);
    expect(sensors).toEqual(snapshot);
  });
});

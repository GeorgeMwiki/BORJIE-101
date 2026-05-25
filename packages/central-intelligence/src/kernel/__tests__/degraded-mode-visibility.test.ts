/**
 * Degraded-mode visibility tests (Round-4 audit, HIGH).
 *
 * Surfaces three contracts:
 *   1. `SensorRouter.getDegradedState()` reflects breaker state +
 *      currentProvider + degradedAt timestamps.
 *   2. `NotYetWiredError` carries `degraded: true` + an
 *      affected-capability list; `toRefusalPayload()` returns the
 *      structured shape the kernel consumes.
 *   3. `BrainDecision.degraded` exists as an optional field on every
 *      decision shape (answer / softened / refusal).
 */

import { describe, it, expect } from 'vitest';
import {
  createSensorRouter,
  NotYetWiredError,
  NOT_YET_WIRED_REASON,
  type BrainDecision,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
} from '../index.js';
import { isNotYetWired } from '../not-yet-wired.js';

const ARGS: SensorCallArgs = {
  system: 'test-system',
  userMessage: 'hello',
  priorTurns: [],
  extendedThinking: false,
  stakes: 'low',
};

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

// ─────────────────────────────────────────────────────────────────────
// 1. SensorRouter.getDegradedState()
// ─────────────────────────────────────────────────────────────────────

describe('SensorRouter.getDegradedState', () => {
  it('returns degraded:false when every sensor is closed at boot', () => {
    let now = 0;
    const router = createSensorRouter({
      sensors: [okSensor('primary', 1), okSensor('backup', 5)],
      clock: () => now,
    });
    const state = router.getDegradedState();
    expect(state.degraded).toBe(false);
    expect(state.openSensors).toEqual([]);
    expect(state.currentProvider).toBe('primary');
    expect(state.degradedAt).toBeNull();
    expect(state.lastFailedAt).toBeNull();
  });

  it('flips degraded:true when the primary breaker opens', async () => {
    let now = 0;
    const router = createSensorRouter({
      sensors: [failingSensor('primary', 1), okSensor('backup', 5)],
      coolDownMs: 10_000,
      clock: () => now,
    });
    for (let i = 0; i < 3; i++) {
      await router.call(ARGS, ['fast']).catch(() => undefined);
      now += 10;
    }
    const state = router.getDegradedState();
    expect(state.degraded).toBe(true);
    expect(state.openSensors).toContain('primary');
    // currentProvider should now be the backup
    expect(state.currentProvider).toBe('backup');
    expect(state.degradedAt).toBeGreaterThan(0);
    expect(state.lastFailedAt).toBeGreaterThan(0);
  });

  it('still reports degraded when all breakers are open (last-resort routing)', async () => {
    let now = 0;
    const router = createSensorRouter({
      sensors: [failingSensor('a', 1), failingSensor('b', 5)],
      coolDownMs: 10_000,
      breakerThreshold: 2,
      clock: () => now,
    });
    for (let i = 0; i < 4; i++) {
      await router.call(ARGS, ['fast']).catch(() => undefined);
      now += 10;
    }
    const state = router.getDegradedState();
    expect(state.degraded).toBe(true);
    expect(state.openSensors.length).toBeGreaterThan(0);
    // currentProvider should not be null — even cooled-down sensors are
    // surfaced so operators see what would serve.
    expect(state.currentProvider).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. NotYetWiredError + isNotYetWired
// ─────────────────────────────────────────────────────────────────────

describe('NotYetWiredError degraded-mode tagging', () => {
  it('carries degraded:true on every instance', () => {
    const err = new NotYetWiredError(NOT_YET_WIRED_REASON.NIDA_PORT);
    expect(err.degraded).toBe(true);
    expect(err.reason).toBe('nida-port');
    expect(err.name).toBe('NotYetWiredError');
  });

  it('defaults affectedCapabilities to [reason]', () => {
    const err = new NotYetWiredError(NOT_YET_WIRED_REASON.EVICTION_DISPATCHER);
    expect([...err.affectedCapabilities]).toEqual(['eviction-dispatcher']);
  });

  it('accepts a richer affectedCapabilities list', () => {
    const err = new NotYetWiredError(NOT_YET_WIRED_REASON.NIDA_PORT, {
      affectedCapabilities: ['platform.verify_nida', 'platform.evict_tenant'],
    });
    expect([...err.affectedCapabilities]).toEqual([
      'platform.verify_nida',
      'platform.evict_tenant',
    ]);
  });

  it('toRefusalPayload returns the structured shape', () => {
    const err = new NotYetWiredError(NOT_YET_WIRED_REASON.KRA_MRI_DISPATCHER);
    const payload = err.toRefusalPayload();
    expect(payload.degraded).toBe(true);
    expect(payload.reason).toBe('kra-mri-dispatcher');
    expect([...payload.affectedCapabilities]).toEqual(['kra-mri-dispatcher']);
  });

  it('isNotYetWired recognises NotYetWiredError instances', () => {
    const err = new NotYetWiredError('nida-port');
    expect(isNotYetWired(err)).toBe(true);
  });

  it('isNotYetWired recognises structurally-equivalent errors (cross-realm)', () => {
    // Simulate a cross-realm error (e.g. when two copies of the module
    // exist in a test setup) by hand-constructing the shape.
    const fake = {
      name: 'NotYetWiredError',
      degraded: true,
      reason: 'fake-realm',
      message: 'cross-realm',
    };
    expect(isNotYetWired(fake)).toBe(true);
  });

  it('isNotYetWired rejects unrelated errors', () => {
    expect(isNotYetWired(new Error('boom'))).toBe(false);
    expect(isNotYetWired(null)).toBe(false);
    expect(isNotYetWired({ name: 'OtherError' })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. BrainDecision.degraded field shape
// ─────────────────────────────────────────────────────────────────────

describe('BrainDecision degraded marker', () => {
  it('accepts the field on answer shape (type-level + runtime)', () => {
    const decision: BrainDecision = {
      kind: 'answer',
      text: 'hi',
      citations: [],
      artifacts: [],
      confidence: {
        groundedness: 1,
        stability: 1,
        review: 1,
        numericalConsistency: 1,
        overall: 1,
      },
      gates: {
        inviolable: { status: 'pass' },
        policy: { status: 'pass' },
        drift: { status: 'pass' },
        cognitiveLoad: { status: 'pass' },
      },
      provenance: {
        thoughtId: 't',
        threadId: 'th',
        scopeKind: 'tenant',
        tier: 'tenant',
        stakes: 'low',
        inputHash: 'x',
        outputHash: 'y',
        toolCallSummaries: [],
        sensorId: 's',
        modelId: 'm',
        cacheHit: false,
        judgeScore: null,
        cohortFingerprints: [],
        producedAt: new Date().toISOString(),
        latencyMs: 1,
      },
      degraded: {
        reason: 'not-yet-wired: nida-port',
        affected_capabilities: ['nida-port'],
        since: new Date().toISOString(),
      },
    };
    expect(decision.kind).toBe('answer');
    if (decision.kind === 'answer') {
      expect(decision.degraded?.reason).toMatch(/nida-port/);
      expect(decision.degraded?.affected_capabilities).toEqual(['nida-port']);
    }
  });

  it('accepts the field on refusal shape', () => {
    const decision: BrainDecision = {
      kind: 'refusal',
      reason: 'blocked',
      gateThatRefused: 'policy',
      provenance: {
        thoughtId: 't',
        threadId: 'th',
        scopeKind: 'tenant',
        tier: 'tenant',
        stakes: 'low',
        inputHash: 'x',
        outputHash: 'y',
        toolCallSummaries: [],
        sensorId: '__refused__',
        modelId: '__refused__',
        cacheHit: false,
        judgeScore: null,
        cohortFingerprints: [],
        producedAt: new Date().toISOString(),
        latencyMs: 1,
      },
      degraded: {
        reason: 'sensor-failover: serving via backup',
        affected_capabilities: ['sensor:primary'],
      },
    };
    if (decision.kind === 'refusal') {
      expect(decision.degraded?.affected_capabilities).toContain('sensor:primary');
    }
  });

  it('field is optional — decisions without degraded compile + run', () => {
    const decision: BrainDecision = {
      kind: 'answer',
      text: 'hi',
      citations: [],
      artifacts: [],
      confidence: {
        groundedness: 1,
        stability: 1,
        review: 1,
        numericalConsistency: 1,
        overall: 1,
      },
      gates: {
        inviolable: { status: 'pass' },
        policy: { status: 'pass' },
        drift: { status: 'pass' },
        cognitiveLoad: { status: 'pass' },
      },
      provenance: {
        thoughtId: 't',
        threadId: 'th',
        scopeKind: 'tenant',
        tier: 'tenant',
        stakes: 'low',
        inputHash: 'x',
        outputHash: 'y',
        toolCallSummaries: [],
        sensorId: 's',
        modelId: 'm',
        cacheHit: false,
        judgeScore: null,
        cohortFingerprints: [],
        producedAt: new Date().toISOString(),
        latencyMs: 1,
      },
    };
    if (decision.kind === 'answer') {
      expect(decision.degraded).toBeUndefined();
    }
  });
});

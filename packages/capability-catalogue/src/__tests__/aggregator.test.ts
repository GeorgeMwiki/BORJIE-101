import { describe, it, expect } from 'vitest';

import { aggregateMeasurement, type Invocation, type Outcome } from '../index.js';

function inv(id: string, success = true): Invocation {
  return {
    id,
    tenantId: 't',
    capabilityId: 'cap-1',
    invokedAt: new Date().toISOString(),
    latencyMs: 100,
    success,
    errorKind: null,
    costUsdCents: 0,
    auditHash: 'h',
  };
}

function out(
  invId: string,
  observed: Outcome['observedOutcome'],
  followthrough: Outcome['userFollowthrough'],
  confidence = 0.5,
): Outcome {
  return {
    id: `o-${invId}`,
    invocationId: invId,
    claimedConfidence: confidence,
    observedOutcome: observed,
    userFollowthrough: followthrough,
    recordedAt: new Date().toISOString(),
    auditHash: 'h',
  };
}

describe('aggregateMeasurement', () => {
  it('returns null when window has no invocations', () => {
    const m = aggregateMeasurement({
      tenantId: 't',
      capabilityId: 'cap-1',
      windowDays: 7,
      measuredAt: new Date().toISOString(),
      invocations: [],
      outcomes: [],
    });
    expect(m).toBeNull();
  });

  it('computes all three axes + stamps audit hash', () => {
    const invs: Array<Invocation> = [
      inv('1', true),
      inv('2', true),
      inv('3', false),
    ];
    const outs: Array<Outcome> = [
      out('1', 'confirmed', 'accepted', 0.9),
      out('2', 'confirmed', 'modified', 0.7),
      out('3', 'disconfirmed', 'rejected', 0.6),
    ];
    const m = aggregateMeasurement({
      tenantId: 't',
      capabilityId: 'cap-1',
      windowDays: 7,
      measuredAt: '2026-05-26T00:00:00.000Z',
      invocations: invs,
      outcomes: outs,
    });
    expect(m).not.toBeNull();
    expect(m!.nObservations).toBe(3);
    expect(m!.competenceRate).toBeCloseTo(2 / 3, 10);
    expect(m!.calibrationError).toBeGreaterThan(0);
    expect(m!.utilityRate).toBeCloseTo((1 + 0.5) / 3, 10);
    expect(m!.auditHash).toMatch(/^[a-f0-9]{64}$/);
    expect(m!.windowDays).toBe(7);
  });

  it('returns 0 for calibration + utility when outcomes are empty but invocations exist', () => {
    const m = aggregateMeasurement({
      tenantId: 't',
      capabilityId: 'cap-1',
      windowDays: 28,
      measuredAt: new Date().toISOString(),
      invocations: [inv('1'), inv('2')],
      outcomes: [],
    });
    expect(m).not.toBeNull();
    expect(m!.competenceRate).toBe(1);
    expect(m!.calibrationError).toBe(0);
    expect(m!.utilityRate).toBe(0);
  });
});

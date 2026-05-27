/**
 * Tests for the intel-trace curator.
 *
 * Verifies:
 *   - confirmed + accepted ⇒ reward = 1, included.
 *   - partial + rejected   ⇒ reward = 0.25, excluded by default floor.
 *   - unknown + ignored    ⇒ excluded with `observation_unknown`.
 */

import { describe, expect, it } from 'vitest';
import {
  curateIntelTrainingPairs,
  DEFAULT_INTEL_CURATOR_CONFIG,
  shapeIntelTrainingPair,
  type IntelInvocationAuditRow,
} from '../index.js';

function buildRow(
  overrides: Partial<IntelInvocationAuditRow>,
): IntelInvocationAuditRow {
  const base: IntelInvocationAuditRow = Object.freeze({
    id: '00000000-0000-0000-0000-000000000001',
    tenantId: 'tenant-acme',
    capabilityId: '11111111-1111-1111-1111-111111111111',
    intelKind: 'forecast',
    inputPayload: Object.freeze({ target: 'gold_price', horizon: 1 }),
    outputPayload: Object.freeze({ point: 1842 }),
    claimedConfidence: 0.85,
    latencyMs: 12,
    costUsdCents: 5,
    observedOutcome: 'confirmed',
    userFollowthrough: 'accepted',
    observationPayload: Object.freeze({ observed: 1840 }),
    invokedAt: '2026-05-27T08:00:00.000Z',
    observedAt: '2026-05-28T08:00:00.000Z',
    prevHash: '',
    auditHash: 'abc',
  });
  return Object.freeze({ ...base, ...overrides });
}

describe('shapeIntelTrainingPair', () => {
  it('emits reward = 1 for confirmed + accepted', () => {
    const row = buildRow({});
    const pair = shapeIntelTrainingPair(row);
    expect(pair.reward).toBe(1);
    expect(pair.included).toBe(true);
    expect(pair.exclusionReason).toBeNull();
    expect(pair.prompt).toEqual({ target: 'gold_price', horizon: 1 });
    expect(pair.completion).toEqual({ point: 1842 });
  });

  it('excludes partial + rejected as reward_below_floor', () => {
    const row = buildRow({
      observedOutcome: 'partial',
      userFollowthrough: 'rejected',
    });
    const pair = shapeIntelTrainingPair(row);
    // base 0.5 × utility 0.5 = 0.25 < 0.5 floor
    expect(pair.reward).toBeCloseTo(0.25, 5);
    expect(pair.included).toBe(false);
    expect(pair.exclusionReason).toBe('reward_below_floor');
  });

  it('excludes unknown observations by default', () => {
    const row = buildRow({
      observedOutcome: 'unknown',
      userFollowthrough: 'ignored',
    });
    const pair = shapeIntelTrainingPair(row);
    expect(pair.included).toBe(false);
    expect(pair.exclusionReason).toBe('observation_unknown');
  });

  it('includes unknown observations when overridden', () => {
    const row = buildRow({
      observedOutcome: 'unknown',
      userFollowthrough: 'accepted',
    });
    const pair = shapeIntelTrainingPair(row, {
      ...DEFAULT_INTEL_CURATOR_CONFIG,
      includeUnknown: true,
    });
    // unknown maps to baseReward 0; utility kicker 1.0 → reward 0; below floor.
    expect(pair.included).toBe(false);
    expect(pair.exclusionReason).toBe('reward_below_floor');
  });
});

describe('curateIntelTrainingPairs', () => {
  it('shapes a batch deterministically', () => {
    const rows = [
      buildRow({ id: '00000000-0000-0000-0000-000000000001' }),
      buildRow({
        id: '00000000-0000-0000-0000-000000000002',
        observedOutcome: 'disconfirmed',
        userFollowthrough: 'rejected',
      }),
    ];
    const pairs = curateIntelTrainingPairs(rows);
    expect(pairs.length).toBe(2);
    expect(pairs[0]?.reward).toBe(1);
    expect(pairs[1]?.reward).toBe(0);
    expect(pairs[1]?.included).toBe(false);
  });
});

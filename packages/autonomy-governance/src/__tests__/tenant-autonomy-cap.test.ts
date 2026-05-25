/**
 * Tenant autonomy cap — policy DSL + evaluator tests.
 */

import { describe, it, expect } from 'vitest';
import {
  defaultCap,
  parseCapPolicy,
  evaluateAutonomyCap,
} from '../caps/tenant-autonomy-cap.js';
import type { AutonomyRollingState } from '../types.js';

const TENANT = '11111111-1111-1111-1111-111111111111';

function emptyState(tenantId: string): AutonomyRollingState {
  return Object.freeze({
    tenantId,
    mutationsToday: 0,
    costUsdCentsToday: 0,
    perSubMd: {},
    perToolTier: {},
    asOf: new Date().toISOString(),
  });
}

describe('parseCapPolicy', () => {
  it('produces a frozen cap with platform defaults', () => {
    const cap = parseCapPolicy({
      tenantId: TENANT,
      updatedBy: 'tester',
    });
    expect(cap.maxAutonomousMutationsPerDay).toBe(50);
    expect(cap.maxAutonomousCostUsdCentsPerDay).toBe(5_000_00);
    expect(cap.slowdownAt).toBe(0.8);
    expect(cap.hardStopAt).toBe(1.0);
    expect(Object.isFrozen(cap)).toBe(true);
  });

  it('refuses a malformed UUID tenantId', () => {
    expect(() =>
      parseCapPolicy({ tenantId: 'not-a-uuid', updatedBy: 'tester' }),
    ).toThrow();
  });

  it('refuses slowdownAt > hardStopAt', () => {
    expect(() =>
      parseCapPolicy({
        tenantId: TENANT,
        slowdownAt: 0.95,
        hardStopAt: 0.9,
        updatedBy: 'tester',
      }),
    ).toThrow(/slowdownAt/);
  });

  it('defaultCap blocks destroy + sovereign tiers', () => {
    const cap = defaultCap(TENANT);
    expect(cap.perToolTierCaps.destroy).toBe(0);
    expect(cap.perToolTierCaps.sovereign).toBe(0);
    expect(cap.perToolTierCaps.billing).toBe(5);
  });
});

describe('evaluateAutonomyCap', () => {
  it('allows a fresh request well within all envelopes', () => {
    const cap = defaultCap(TENANT);
    const state = emptyState(TENANT);
    const verdict = evaluateAutonomyCap(
      cap,
      { subMd: 'arrears-triage', tier: 'mutate', estimatedCostUsdCents: 10 },
      state,
    );
    expect(verdict.kind).toBe('allow');
    expect(verdict.headroomPct).toBeCloseTo(1.0, 5);
  });

  it('hard-denies a tier-0 action (destroy)', () => {
    const cap = defaultCap(TENANT);
    const verdict = evaluateAutonomyCap(
      cap,
      { subMd: 'arrears-triage', tier: 'destroy', estimatedCostUsdCents: 0 },
      emptyState(TENANT),
    );
    expect(verdict.kind).toBe('deny-tier-blocked');
    expect(verdict.trippedEnvelope).toBe('tool-tier');
  });

  it('engages slowdown-ask-owner at 80% of tenant mutation cap', () => {
    const cap = defaultCap(TENANT);
    // After this action: 40/50 = 0.8 → exactly at slowdown.
    const state: AutonomyRollingState = {
      ...emptyState(TENANT),
      mutationsToday: 39,
    };
    const verdict = evaluateAutonomyCap(
      cap,
      { subMd: 'arrears-triage', tier: 'mutate', estimatedCostUsdCents: 1 },
      state,
    );
    expect(verdict.kind).toBe('slowdown-ask-owner');
    expect(verdict.trippedEnvelope).toBe('tenant-mutations');
  });

  it('hard-denies once mutation cap is exceeded', () => {
    const cap = defaultCap(TENANT);
    const state: AutonomyRollingState = {
      ...emptyState(TENANT),
      mutationsToday: 50,
    };
    const verdict = evaluateAutonomyCap(
      cap,
      { subMd: 'arrears-triage', tier: 'mutate', estimatedCostUsdCents: 1 },
      state,
    );
    expect(verdict.kind).toBe('deny-cap-exceeded');
  });

  it('hard-denies AT the cap boundary, not above (H6 off-by-one)', () => {
    // Pre-fix: with hardStopAt=1.0 and ceiling=50, an action that landed
    // at ratio = 50/50 = 1.0 was NOT > 1.0, so the check fell through to
    // slowdownAt and returned slowdown-ask-owner. Tenants could hit
    // their documented hard cap exactly and only get a warning. Fix uses
    // >= so ratio === hardStopAt is denied.
    const cap = defaultCap(TENANT);
    const state: AutonomyRollingState = {
      ...emptyState(TENANT),
      mutationsToday: 49, // after +1 = 50; ratio = 50/50 = 1.0
    };
    const verdict = evaluateAutonomyCap(
      cap,
      { subMd: 'arrears-triage', tier: 'mutate', estimatedCostUsdCents: 0 },
      state,
    );
    expect(verdict.kind).toBe('deny-cap-exceeded');
  });

  it('accepts an optional IANA timezone on the cap (H8)', () => {
    const cap = parseCapPolicy({
      tenantId: TENANT,
      timezone: 'Africa/Nairobi',
      updatedBy: 'tester',
    });
    expect(cap.timezone).toBe('Africa/Nairobi');
  });

  it('rejects a malformed timezone (H8)', () => {
    expect(() =>
      parseCapPolicy({
        tenantId: TENANT,
        timezone: 'not-a-zone',
        updatedBy: 'tester',
      }),
    ).toThrow();
  });

  it('hard-denies once tenant cost cap is exceeded', () => {
    const cap = defaultCap(TENANT);
    const state: AutonomyRollingState = {
      ...emptyState(TENANT),
      costUsdCentsToday: 5_000_00,
    };
    const verdict = evaluateAutonomyCap(
      cap,
      { subMd: 'arrears-triage', tier: 'mutate', estimatedCostUsdCents: 1 },
      state,
    );
    expect(verdict.kind).toBe('deny-cap-exceeded');
    expect(verdict.trippedEnvelope).toBe('tenant-cost');
  });

  it('honours per-sub-MD cap before tenant cap', () => {
    const cap = parseCapPolicy({
      tenantId: TENANT,
      maxAutonomousMutationsPerDay: 100,
      maxAutonomousCostUsdCentsPerDay: 10_000_00,
      perSubMdCaps: {
        'kra-filing': { maxMutationsPerDay: 2, maxCostUsdCentsPerDay: 100 },
      },
      updatedBy: 'tester',
    });
    const state: AutonomyRollingState = {
      ...emptyState(TENANT),
      perSubMd: {
        'kra-filing': { mutationsToday: 2, costUsdCentsToday: 0 },
      },
    };
    const verdict = evaluateAutonomyCap(
      cap,
      { subMd: 'kra-filing', tier: 'mutate', estimatedCostUsdCents: 0 },
      state,
    );
    expect(verdict.kind).toBe('deny-cap-exceeded');
    expect(verdict.trippedEnvelope).toBe('sub-md-mutations');
  });

  it('returns deny when tenantId mismatches state', () => {
    const cap = defaultCap(TENANT);
    const verdict = evaluateAutonomyCap(
      cap,
      { subMd: 'x', tier: 'mutate', estimatedCostUsdCents: 0 },
      emptyState('22222222-2222-2222-2222-222222222222'),
    );
    expect(verdict.kind).toBe('deny-cap-exceeded');
    expect(verdict.reason).toMatch(/tenantId mismatch/);
  });
});

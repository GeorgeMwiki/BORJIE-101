/**
 * Per-tier isolation gate tests. Verifies the three scope rules + the
 * k-anonymity floor for platform aggregation.
 */

import { describe, it, expect } from 'vitest';

import { enforceIsolation, isolationAllowed } from '../per-tier-isolation.js';
import type { LearningSignal, TenantScope } from '../types.js';

function signal(
  scope: TenantScope,
  overrides: Partial<LearningSignal> = {},
): LearningSignal {
  return {
    signalHash: 'h',
    actionRef: 'a',
    actionKind: 'decide',
    reward: 0.5,
    components: {
      sla: 0,
      override: 0,
      complaint: 0,
      regulator: 0,
      cost: 0,
      satisfaction: 0,
    },
    tenantScope: scope,
    subjectUserId: null,
    subjectOrgId: null,
    emittedBy: 'test',
    capturedAt: '2026-06-03T00:00:00.000Z',
    ...overrides,
  };
}

describe('per-tier isolation', () => {
  it('allows a well-formed user-scoped signal', () => {
    const r = enforceIsolation({ signal: signal('user', { subjectUserId: 'u1' }) });
    expect(r.ok).toBe(true);
  });

  it('rejects a user-scoped signal missing subjectUserId', () => {
    const r = enforceIsolation({ signal: signal('user') });
    expect(r.ok).toBe(false);
  });

  it('rejects a user-scoped signal carrying an org id (bleed prevention)', () => {
    const r = enforceIsolation({
      signal: signal('user', { subjectUserId: 'u1', subjectOrgId: 'o1' }),
    });
    expect(r.ok).toBe(false);
  });

  it('allows a well-formed org-scoped signal', () => {
    const r = enforceIsolation({ signal: signal('org', { subjectOrgId: 'o1' }) });
    expect(r.ok).toBe(true);
  });

  it('rejects an org-scoped signal carrying a user id', () => {
    const r = enforceIsolation({
      signal: signal('org', { subjectOrgId: 'o1', subjectUserId: 'u1' }),
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a platform-scoped signal below the k-anonymity floor', () => {
    const r = enforceIsolation({ signal: signal('platform'), cohortSize: 10 });
    expect(r.ok).toBe(false);
  });

  it('allows a platform-scoped signal at or above the floor', () => {
    const r = enforceIsolation({ signal: signal('platform'), cohortSize: 25 });
    expect(r.ok).toBe(true);
  });

  it('rejects a platform-scoped signal carrying scope ids', () => {
    const r = enforceIsolation({
      signal: signal('platform', { subjectUserId: 'u1' }),
      cohortSize: 100,
    });
    expect(r.ok).toBe(false);
  });

  it('honours an overridden k-anonymity threshold', () => {
    expect(
      isolationAllowed({ signal: signal('platform'), cohortSize: 5, kAnonymity: 3 }),
    ).toBe(true);
  });
});

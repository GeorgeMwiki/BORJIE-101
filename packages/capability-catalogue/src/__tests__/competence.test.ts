import { describe, it, expect } from 'vitest';

import { computeCompetence, CapabilityCatalogueError, type Invocation, type Outcome } from '../index.js';

function inv(partial: Partial<Invocation> = {}): Invocation {
  return {
    id: partial.id ?? 'inv-x',
    tenantId: 't',
    capabilityId: 'cap',
    invokedAt: new Date().toISOString(),
    latencyMs: 100,
    success: partial.success ?? true,
    errorKind: null,
    costUsdCents: 0,
    auditHash: 'h',
    ...partial,
  };
}

describe('competence', () => {
  it('returns 1.0 when all invocations succeed and no outcomes disconfirm', () => {
    const res = computeCompetence({
      invocations: [inv({ id: '1' }), inv({ id: '2' }), inv({ id: '3' })],
    });
    expect(res.rate).toBe(1);
    expect(res.nObservations).toBe(3);
    expect(res.successes).toBe(3);
  });

  it('returns 0.5 with a mix of success / failure', () => {
    const res = computeCompetence({
      invocations: [
        inv({ id: '1', success: true }),
        inv({ id: '2', success: false }),
      ],
    });
    expect(res.rate).toBe(0.5);
  });

  it('flips success → false when outcome is `disconfirmed`', () => {
    const outcomes = new Map<string, Outcome>();
    outcomes.set('1', {
      id: 'o1',
      invocationId: '1',
      claimedConfidence: 0.9,
      observedOutcome: 'disconfirmed',
      userFollowthrough: 'ignored',
      recordedAt: new Date().toISOString(),
      auditHash: 'h',
    });
    const res = computeCompetence({
      invocations: [inv({ id: '1' }), inv({ id: '2' })],
      outcomesByInvocationId: outcomes,
    });
    expect(res.successes).toBe(1);
    expect(res.rate).toBe(0.5);
  });

  it('throws on empty input', () => {
    expect(() => computeCompetence({ invocations: [] })).toThrow(
      CapabilityCatalogueError,
    );
  });
});

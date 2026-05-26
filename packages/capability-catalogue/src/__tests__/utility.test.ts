import { describe, it, expect } from 'vitest';

import { computeUtility, CapabilityCatalogueError, type Outcome } from '../index.js';

function out(followthrough: Outcome['userFollowthrough']): Outcome {
  return {
    id: 'o',
    invocationId: 'i',
    claimedConfidence: 0.5,
    observedOutcome: 'confirmed',
    userFollowthrough: followthrough,
    recordedAt: new Date().toISOString(),
    auditHash: 'h',
  };
}

describe('utility', () => {
  it('returns 1.0 when every output is accepted', () => {
    const res = computeUtility({
      outcomes: [out('accepted'), out('accepted'), out('accepted')],
    });
    expect(res.rate).toBe(1);
  });

  it('weights modified at 0.5', () => {
    const res = computeUtility({
      outcomes: [out('modified'), out('modified')],
    });
    expect(res.rate).toBe(0.5);
    expect(res.modified).toBe(2);
  });

  it('counts rejected + ignored as zero contribution', () => {
    const res = computeUtility({
      outcomes: [
        out('accepted'),
        out('rejected'),
        out('ignored'),
        out('modified'),
      ],
    });
    expect(res.rate).toBeCloseTo((1 + 0.5) / 4, 10);
  });

  it('throws on empty input', () => {
    expect(() => computeUtility({ outcomes: [] })).toThrow(
      CapabilityCatalogueError,
    );
  });
});

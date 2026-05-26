import { describe, it, expect } from 'vitest';

import { computeCalibration, CapabilityCatalogueError, type Outcome } from '../index.js';

function out(partial: Partial<Outcome>): Outcome {
  return {
    id: partial.id ?? 'o',
    invocationId: 'i',
    claimedConfidence: partial.claimedConfidence ?? 0.5,
    observedOutcome: partial.observedOutcome ?? 'confirmed',
    userFollowthrough: partial.userFollowthrough ?? 'accepted',
    recordedAt: new Date().toISOString(),
    auditHash: 'h',
  };
}

describe('calibration', () => {
  it('scores a perfect oracle at 0 error', () => {
    const outs: Array<Outcome> = [
      out({ claimedConfidence: 1, observedOutcome: 'confirmed' }),
      out({ claimedConfidence: 0, observedOutcome: 'disconfirmed' }),
      out({ claimedConfidence: 1, observedOutcome: 'confirmed' }),
    ];
    const res = computeCalibration({ outcomes: outs });
    expect(res.brier).toBe(0);
    expect(res.ece).toBe(0);
    expect(res.error).toBe(0);
  });

  it('penalises a confidently wrong predictor', () => {
    const outs: Array<Outcome> = [
      out({ claimedConfidence: 1, observedOutcome: 'disconfirmed' }),
      out({ claimedConfidence: 1, observedOutcome: 'disconfirmed' }),
    ];
    const res = computeCalibration({ outcomes: outs });
    expect(res.brier).toBe(1);
    expect(res.ece).toBe(1);
    expect(res.error).toBe(1);
  });

  it('drops `unknown` outcomes but still scores remainder', () => {
    const outs: Array<Outcome> = [
      out({ claimedConfidence: 1, observedOutcome: 'unknown' }),
      out({ claimedConfidence: 1, observedOutcome: 'confirmed' }),
    ];
    const res = computeCalibration({ outcomes: outs });
    expect(res.nObservations).toBe(1);
    expect(res.error).toBe(0);
  });

  it('throws on empty input', () => {
    expect(() => computeCalibration({ outcomes: [] })).toThrow(
      CapabilityCatalogueError,
    );
  });
});

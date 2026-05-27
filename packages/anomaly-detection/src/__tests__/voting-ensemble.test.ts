/**
 * Voting ensemble — combination validation.
 *
 * Acceptance criteria:
 *   T13. majority of three detectors yields anomalous.
 *   T14. minority of three detectors yields NOT anomalous.
 */

import { describe, expect, it } from 'vitest';

import { combineVotes } from '../ensemble/voting-ensemble.js';
import type { AnomalyScore } from '../types.js';

function s(
  detectorKind: 'iforest' | 'lof' | 'zscore',
  score: number,
  threshold: number,
  anomalous: boolean,
): AnomalyScore {
  return {
    value: 0,
    score,
    scoreKind: detectorKind,
    threshold,
    anomalous,
  };
}

describe('voting-ensemble', () => {
  it('majority of three detectors yields anomalous (T13)', () => {
    const verdict = combineVotes(
      [
        { detectorId: 'iforest', score: s('iforest', 0.7, 0.5, true) },
        { detectorId: 'lof', score: s('lof', 2.5, 1.5, true) },
        { detectorId: 'zscore', score: s('zscore', 1, 3, false) },
      ],
      { mode: 'majority' },
    );
    expect(verdict.anomalous).toBe(true);
    expect(verdict.mode).toBe('majority');
    expect(verdict.votes).toBe(2);
    expect(verdict.totalMembers).toBe(3);
    expect(verdict.contributions).toHaveLength(3);
  });

  it('minority of three detectors yields NOT anomalous (T14)', () => {
    const verdict = combineVotes(
      [
        { detectorId: 'iforest', score: s('iforest', 0.7, 0.5, true) },
        { detectorId: 'lof', score: s('lof', 1.2, 1.5, false) },
        { detectorId: 'zscore', score: s('zscore', 1, 3, false) },
      ],
      { mode: 'majority' },
    );
    expect(verdict.anomalous).toBe(false);
    expect(verdict.votes).toBe(1);
  });

  it('weighted mode combines normalised scores', () => {
    const verdict = combineVotes(
      [
        { detectorId: 'iforest', score: s('iforest', 0.9, 0.5, true), weight: 0.7 },
        { detectorId: 'zscore', score: s('zscore', 0.5, 3, false), weight: 0.3 },
      ],
      { mode: 'weighted', threshold: 0.5 },
    );
    expect(verdict.mode).toBe('weighted');
    expect(verdict.anomalous).toBe(true);
    // 0.9 * 0.7 + (0.5 / (0.5 + 3)) * 0.3 ≈ 0.63 + 0.0428 = 0.6728
    expect(verdict.combinedScore).toBeGreaterThan(0.6);
  });

  it('throws on empty member list', () => {
    expect(() => combineVotes([])).toThrow(/at least one member/);
  });
});

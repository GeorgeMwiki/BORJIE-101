/**
 * DPO preference-learner tests (LP-18). Verifies the logistic head learns the
 * winning direction, the loss decreases after training, prediction + ranking
 * behave, and mis-shaped pairs are skipped.
 */

import { describe, it, expect } from 'vitest';

import {
  createHeadState,
  trainHead,
  predictWinProbability,
  dpoLoss,
  rankByPreferenceHead,
  inferModalDimension,
} from '../preference-learner.js';
import type { PreferencePair } from '../learning-types.js';

function pair(
  winner: number[],
  loser: number[],
  overrides: Partial<PreferencePair> = {},
): PreferencePair {
  return {
    contextHash: 'ctx',
    winnerFeatures: winner,
    loserFeatures: loser,
    winnerReward: 1,
    loserReward: 0,
    tenantScope: 'platform',
    ...overrides,
  };
}

describe('preference-learner — training', () => {
  it('decreases DPO loss after training on a separable batch', () => {
    const start = createHeadState(2);
    // Winner always has higher x[0]; the head should learn w[0] > 0.
    const pairs = [
      pair([1, 0], [0, 0]),
      pair([2, 1], [0, 1]),
      pair([3, 0], [1, 0]),
      pair([1, 1], [0, 1]),
    ];
    const before = dpoLoss(start, pairs);
    const trained = trainHead(start, pairs, {
      learningRate: 0.2,
      l2: 0.0001,
      epochs: 200,
    });
    const after = dpoLoss(trained, pairs);
    expect(after).toBeLessThan(before);
    // The learned weight on the discriminating feature is positive.
    expect(trained.weights[0]).toBeGreaterThan(0);
    expect(trained.seenPairs).toBe(start.seenPairs + pairs.length);
  });

  it('keeps the input state immutable', () => {
    const start = createHeadState(2);
    trainHead(start, [pair([1, 0], [0, 0])]);
    expect(start.weights).toEqual([0, 0]);
    expect(start.seenPairs).toBe(0);
  });

  it('is a no-op on an empty batch', () => {
    const start = createHeadState(3);
    const out = trainHead(start, []);
    expect(out).toBe(start);
  });

  it('skips mis-shaped pairs without throwing', () => {
    const start = createHeadState(2);
    const pairs = [pair([1, 0], [0, 0]), pair([1, 2, 3], [0])];
    const out = trainHead(start, pairs, {
      learningRate: 0.1,
      l2: 0,
      epochs: 10,
    });
    expect(Number.isFinite(out.weights[0])).toBe(true);
  });
});

describe('preference-learner — predict + rank', () => {
  it('predicts > 0.5 for the variant aligned with learned weights', () => {
    const trained = trainHead(
      createHeadState(2),
      [pair([1, 0], [0, 0]), pair([2, 0], [0, 0]), pair([3, 0], [1, 0])],
      { learningRate: 0.3, l2: 0.0001, epochs: 300 },
    );
    const p = predictWinProbability(trained, [5, 0], [0, 0]);
    expect(p).toBeGreaterThan(0.5);
  });

  it('returns 0.5 on dimension mismatch', () => {
    const head = createHeadState(2);
    expect(predictWinProbability(head, [1], [0, 0])).toBe(0.5);
  });

  it('ranks the strongest candidate first', () => {
    const trained = trainHead(
      createHeadState(2),
      [pair([1, 0], [0, 0]), pair([2, 0], [0, 0])],
      { learningRate: 0.3, l2: 0.0001, epochs: 300 },
    );
    const ranked = rankByPreferenceHead(trained, [
      { id: 'incumbent', features: [0, 0] },
      { id: 'strong', features: [5, 0] },
      { id: 'weak', features: [-5, 0] },
    ]);
    expect(ranked[0].id).toBe('strong');
  });

  it('passes through ranking on dimension mismatch (additive, never gates)', () => {
    const head = createHeadState(2);
    const candidates = [
      { id: 'a', features: [1] }, // wrong dim
      { id: 'b', features: [2] },
    ];
    expect(rankByPreferenceHead(head, candidates)).toBe(candidates);
  });
});

describe('preference-learner — inferModalDimension', () => {
  it('returns the modal winner-feature length', () => {
    const pairs = [
      pair([1, 2], [0, 0]),
      pair([1, 2], [0, 0]),
      pair([1, 2, 3], [0, 0, 0]),
    ];
    expect(inferModalDimension(pairs)).toBe(2);
  });

  it('returns 0 for an empty batch', () => {
    expect(inferModalDimension([])).toBe(0);
  });
});

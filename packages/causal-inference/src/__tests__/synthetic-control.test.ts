import { describe, expect, it } from 'vitest';
import {
  projectOntoSimplex,
  syntheticControl,
} from '../estimate/synthetic-control.js';
import { CausalInferenceError } from '../types.js';

describe('Synthetic control — toy comparator', () => {
  it('recovers ~zero effect when treated equals donor mean and no treatment effect', () => {
    // Treated pre = average of three donor pre paths.
    // Treated post also tracks the donor average -> ATE ~ 0.
    const r = syntheticControl({
      treatedPre: [1, 2, 3, 4, 5],
      donorPre: [
        [0, 1, 2, 3, 4],
        [2, 3, 4, 5, 6],
        [1, 2, 3, 4, 5],
      ],
      treatedPost: [6, 7, 8],
      donorPost: [
        [5, 6, 7],
        [7, 8, 9],
        [6, 7, 8],
      ],
    });
    expect(Math.abs(r.estimate)).toBeLessThan(0.5);
    expect(r.weights.length).toBe(3);
    // Weights on simplex: non-negative, sum to 1.
    let sum = 0;
    for (const w of r.weights) {
      expect(w).toBeGreaterThanOrEqual(-1e-6);
      sum += w;
    }
    expect(sum).toBeCloseTo(1, 4);
  });

  it('returns weights on the probability simplex', () => {
    const r = syntheticControl({
      treatedPre: [1, 2, 3, 4],
      donorPre: [
        [1, 2, 3, 4],
        [4, 3, 2, 1],
      ],
      treatedPost: [5, 6],
      donorPost: [
        [5, 6],
        [0, 1],
      ],
    });
    let sum = 0;
    for (const w of r.weights) sum += w;
    expect(sum).toBeCloseTo(1, 4);
  });

  it('detects a positive treatment effect on a clean signal', () => {
    // Donors stay flat at 10; treated also flat pre-period; treated
    // post jumps by +5.
    const r = syntheticControl({
      treatedPre: [10, 10, 10, 10],
      donorPre: [
        [10, 10, 10, 10],
        [10, 10, 10, 10],
      ],
      treatedPost: [15, 15, 15],
      donorPost: [
        [10, 10, 10],
        [10, 10, 10],
      ],
    });
    expect(r.estimate).toBeCloseTo(5, 1);
    expect(r.preRmse).toBeLessThan(0.5);
  });

  it('throws on empty donor pool', () => {
    expect(() =>
      syntheticControl({
        treatedPre: [1, 2],
        donorPre: [],
        treatedPost: [3],
        donorPost: [],
      }),
    ).toThrow(CausalInferenceError);
  });
});

describe('projectOntoSimplex', () => {
  it('projects (0.5, 0.5, 0.5) -> (1/3, 1/3, 1/3)', () => {
    const p = projectOntoSimplex([0.5, 0.5, 0.5]);
    expect(p[0]).toBeCloseTo(1 / 3, 6);
    expect(p[1]).toBeCloseTo(1 / 3, 6);
    expect(p[2]).toBeCloseTo(1 / 3, 6);
  });

  it('projects (2, -1, 0) onto the simplex with non-negative entries', () => {
    const p = projectOntoSimplex([2, -1, 0]);
    expect(p.every((v) => v >= 0)).toBe(true);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it('handles already-on-simplex input', () => {
    const p = projectOntoSimplex([0.2, 0.3, 0.5]);
    expect(p[0]).toBeCloseTo(0.2, 6);
    expect(p[1]).toBeCloseTo(0.3, 6);
    expect(p[2]).toBeCloseTo(0.5, 6);
  });
});

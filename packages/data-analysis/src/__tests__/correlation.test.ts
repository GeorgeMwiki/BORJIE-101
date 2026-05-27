/**
 * Correlation — reference-vector validation against Anscombe's quartet
 * and textbook spearman / kendall values.
 */

import { describe as suite, it, expect } from 'vitest';
import { pearson } from '../correlation/pearson.js';
import { spearman } from '../correlation/spearman.js';
import { kendall } from '../correlation/kendall.js';
import { correlationMatrix } from '../correlation/matrix.js';
import {
  ANSCOMBE_X1,
  ANSCOMBE_Y1,
  ANSCOMBE_X2,
  ANSCOMBE_Y2,
  ANSCOMBE_X3,
  ANSCOMBE_Y3,
  ANSCOMBE_X4,
  ANSCOMBE_Y4,
} from '../__fixtures__/anscombe.js';

suite('correlation — reference vectors', () => {
  it("Anscombe's quartet — all four pairs share Pearson r ≈ 0.8164", () => {
    expect(pearson(ANSCOMBE_X1, ANSCOMBE_Y1)).toBeCloseTo(0.8164, 3);
    expect(pearson(ANSCOMBE_X2, ANSCOMBE_Y2)).toBeCloseTo(0.8164, 3);
    expect(pearson(ANSCOMBE_X3, ANSCOMBE_Y3)).toBeCloseTo(0.8164, 3);
    expect(pearson(ANSCOMBE_X4, ANSCOMBE_Y4)).toBeCloseTo(0.8164, 3);
  });

  it('Pearson r on perfectly linear data = +1, anticorrelated = −1', () => {
    expect(pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])).toBeCloseTo(-1, 12);
  });

  it('Spearman r on monotonic transform of x stays at +1', () => {
    // y = x^3 is strictly increasing → Spearman r = 1 exactly, even though
    // Pearson r is < 1.
    const x = [1, 2, 3, 4, 5];
    const y = [1, 8, 27, 64, 125];
    expect(spearman(x, y)).toBeCloseTo(1, 12);
  });

  it("Kendall's tau on 4-swap permutation: C=41, D=4 → τ = 37/45 ≈ 0.8222", () => {
    // y = [2,1,3,5,4,7,6,9,8,10] has 4 adjacent swaps vs sorted [1..10],
    // each contributing 1 discordant pair. With n=10, total pairs = 45,
    // so τ = (C − D)/n0 = (41 − 4)/45 = 37/45 ≈ 0.8222.
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = [2, 1, 3, 5, 4, 7, 6, 9, 8, 10];
    expect(kendall(x, y)).toBeCloseTo(37 / 45, 8);
  });

  it('correlationMatrix diagonal is exactly 1 and is symmetric', () => {
    const m = correlationMatrix(
      [
        { name: 'a', values: [1, 2, 3, 4, 5] },
        { name: 'b', values: [5, 4, 3, 2, 1] },
        { name: 'c', values: [2, 4, 6, 8, 10] },
      ],
      'pearson',
    );
    expect(m.values[0]?.[0]).toBe(1);
    expect(m.values[1]?.[1]).toBe(1);
    expect(m.values[2]?.[2]).toBe(1);
    expect(m.values[0]?.[1]).toBeCloseTo(m.values[1]?.[0] as number, 10);
  });
});

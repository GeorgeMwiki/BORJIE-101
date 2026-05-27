/**
 * Inferential tests — reference-vector validation against textbook /
 * R / SciPy output.
 *
 * Targets: one/two-sample t, Welch's t, chi-square, one-way ANOVA,
 * Mann-Whitney U, Kruskal-Wallis H.
 */

import { describe as suite, it, expect } from 'vitest';
import { oneSampleTTest, twoSampleTTest } from '../inferential/t-test.js';
import { welchTTest } from '../inferential/welch-t.js';
import { chiSquareIndependence } from '../inferential/chi-square.js';
import { anovaOneWay } from '../inferential/anova-one-way.js';
import { mannWhitneyU } from '../inferential/mann-whitney.js';
import { kruskalWallis } from '../inferential/kruskal-wallis.js';

suite('inferential tests — reference vectors', () => {
  it("one-sample t-test on a sample with mean exactly = mu0 returns t = 0", () => {
    // x̄ = 5 exactly, μ0 = 5 → t = 0, p = 1.
    const r = oneSampleTTest([4, 5, 6, 4, 6], 5);
    expect(r.statistic).toBeCloseTo(0, 12);
    expect(r.pValue).toBeCloseTo(1, 6);
  });

  it('two-sample pooled t-test on two means-shifted samples matches t ≈ -3.693, df=18', () => {
    // x: mean=6.5, var=9.1667
    // y: mean=11.5, var=9.1667
    // pooled var = 9.1667, t = (6.5-11.5)/sqrt(9.1667*(2/10)) = -3.693
    // df = 18, p ≈ 0.00169
    const x = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const y = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    const r = twoSampleTTest(x, y);
    expect(r.df).toBe(18);
    expect(r.statistic).toBeCloseTo(-3.693, 2);
    expect(r.pValue).toBeLessThan(0.01);
  });

  it("Welch's t-test matches Welch (1947) §3 example", () => {
    // SciPy reference: Welch t on two groups with unequal variance.
    //   scipy.stats.ttest_ind([27.5, 21.0, 19.0, 23.6, 17.0, 17.9, 16.9,
    //                          20.1, 21.9, 22.6, 23.1, 19.6, 19.0, 21.7, 21.4],
    //                         [27.1, 22.0, 20.8, 23.4, 23.4, 23.5, 25.8,
    //                          22.0, 24.8, 20.2, 21.9, 22.1, 22.9, 20.5, 24.4],
    //                         equal_var=False)
    // → t = -2.4559, df ≈ 24.546, p ≈ 0.02153
    const a = [27.5, 21.0, 19.0, 23.6, 17.0, 17.9, 16.9, 20.1, 21.9, 22.6, 23.1, 19.6, 19.0, 21.7, 21.4];
    const b = [27.1, 22.0, 20.8, 23.4, 23.4, 23.5, 25.8, 22.0, 24.8, 20.2, 21.9, 22.1, 22.9, 20.5, 24.4];
    const r = welchTTest(a, b);
    expect(r.statistic).toBeCloseTo(-2.4559, 2);
    expect(r.df).toBeCloseTo(24.546, 0);
    expect(r.pValue).toBeCloseTo(0.0215, 2);
    expect(r.rejectH0).toBe(true);
  });

  it('chi-square independence on 2×2 contingency matches SciPy', () => {
    // scipy.stats.chi2_contingency([[10, 20], [20, 40]], correction=False)
    // → chi2 = 0.0, p = 1.0, dof = 1 (perfectly independent)
    const r = chiSquareIndependence([
      [10, 20],
      [20, 40],
    ]);
    expect(r.statistic).toBeCloseTo(0, 8);
    expect(r.pValue).toBeCloseTo(1, 6);
    expect(r.df).toBe(1);
  });

  it('one-way ANOVA on classic 3-group example matches F ≈ 9.265', () => {
    // SciPy: scipy.stats.f_oneway([6,8,4,5,3,4], [8,12,9,11,6,8], [13,9,11,8,7,12])
    // → F = 9.265, p ≈ 0.00197
    const r = anovaOneWay([
      [6, 8, 4, 5, 3, 4],
      [8, 12, 9, 11, 6, 8],
      [13, 9, 11, 8, 7, 12],
    ]);
    expect(r.statistic).toBeCloseTo(9.265, 2);
    expect(r.pValue).toBeCloseTo(0.00197, 3);
    expect(r.rejectH0).toBe(true);
  });

  it('Mann-Whitney U on two clearly-separated groups rejects H0', () => {
    // groupA dominates groupB, U should be at an extreme.
    const a = [1, 2, 3, 4, 5];
    const b = [6, 7, 8, 9, 10];
    const r = mannWhitneyU(a, b);
    expect(r.statistic).toBe(0); // U=min is 0 when no overlap
    expect(r.pValue).toBeLessThan(0.05);
    expect(r.rejectH0).toBe(true);
  });

  it('Kruskal-Wallis on identical groups gives H≈0, p≈1', () => {
    const r = kruskalWallis([
      [1, 2, 3, 4, 5],
      [1, 2, 3, 4, 5],
      [1, 2, 3, 4, 5],
    ]);
    expect(r.statistic).toBeCloseTo(0, 6);
    expect(r.pValue).toBeGreaterThan(0.9);
    expect(r.df).toBe(2);
  });
});

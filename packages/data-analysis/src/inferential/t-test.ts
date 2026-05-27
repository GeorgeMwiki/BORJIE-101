/**
 * One-sample and equal-variance two-sample Student's t-test.
 *
 *   One-sample: t = (x̄ − μ0) / (s / √n), df = n − 1
 *   Two-sample (pooled): t = (x̄1 − x̄2) / (s_p · √(1/n1 + 1/n2)),
 *     df = n1 + n2 − 2,
 *     s_p^2 = ((n1−1) s1^2 + (n2−1) s2^2) / (n1 + n2 − 2)
 *
 * Reference: Student (1908). *The probable error of a mean.*
 * Biometrika 6(1):1-25. URL: <https://doi.org/10.2307/2331554>.
 * Date checked: 2026-05-27.
 */

import type { AlternativeHypothesis, HypothesisTestResult } from '../types.js';
import { mean } from '../descriptive/mean.js';
import { variance } from '../descriptive/variance.js';
import { studentTTwoSidedPValue, studentTCdf } from '../distributions/student-t.js';

function oneSidedP(t: number, df: number, alt: AlternativeHypothesis): number {
  if (alt === 'two-sided') return studentTTwoSidedPValue(t, df);
  const cdf = studentTCdf(t, df);
  return alt === 'less' ? cdf : 1 - cdf;
}

export function oneSampleTTest(
  sample: ReadonlyArray<number>,
  mu0: number,
  alternative: AlternativeHypothesis = 'two-sided',
  alpha: number = 0.05,
): HypothesisTestResult {
  if (sample.length < 2) {
    throw new Error('oneSampleTTest: requires n ≥ 2');
  }
  const n = sample.length;
  const xbar = mean(sample);
  const s2 = variance(sample);
  const se = Math.sqrt(s2 / n);
  const t = (xbar - mu0) / se;
  const df = n - 1;
  const pValue = oneSidedP(t, df, alternative);
  return {
    statistic: t,
    pValue,
    df,
    alternative,
    testName: 'one-sample t-test',
    nObservations: n,
    rejectH0: pValue < alpha,
    alpha,
  };
}

export function twoSampleTTest(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
  alternative: AlternativeHypothesis = 'two-sided',
  alpha: number = 0.05,
): HypothesisTestResult {
  if (a.length < 2 || b.length < 2) {
    throw new Error('twoSampleTTest: requires n ≥ 2 in each sample');
  }
  const n1 = a.length;
  const n2 = b.length;
  const m1 = mean(a);
  const m2 = mean(b);
  const v1 = variance(a);
  const v2 = variance(b);
  const sp2 = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2);
  const t = (m1 - m2) / Math.sqrt(sp2 * (1 / n1 + 1 / n2));
  const df = n1 + n2 - 2;
  const pValue = oneSidedP(t, df, alternative);
  return {
    statistic: t,
    pValue,
    df,
    alternative,
    testName: 'two-sample t-test (pooled)',
    nObservations: n1 + n2,
    rejectH0: pValue < alpha,
    alpha,
  };
}

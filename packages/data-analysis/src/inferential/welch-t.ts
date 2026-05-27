/**
 * Welch's t-test for two samples with unequal variances.
 *
 *   t = (x̄1 − x̄2) / √(s1^2/n1 + s2^2/n2)
 *   df = (s1^2/n1 + s2^2/n2)^2 /
 *        ((s1^2/n1)^2/(n1−1) + (s2^2/n2)^2/(n2−1))     (Welch-Satterthwaite)
 *
 * Reference: Welch, B. L. (1947). *The generalization of "Student's"
 * problem when several different population variances are involved.*
 * Biometrika 34(1/2):28-35. URL: <https://doi.org/10.2307/2332510>.
 * Date checked: 2026-05-27.
 */

import type { AlternativeHypothesis, HypothesisTestResult } from '../types.js';
import { mean } from '../descriptive/mean.js';
import { variance } from '../descriptive/variance.js';
import { studentTTwoSidedPValue, studentTCdf } from '../distributions/student-t.js';

export function welchTTest(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
  alternative: AlternativeHypothesis = 'two-sided',
  alpha: number = 0.05,
): HypothesisTestResult {
  if (a.length < 2 || b.length < 2) {
    throw new Error('welchTTest: requires n ≥ 2 in each sample');
  }
  const n1 = a.length;
  const n2 = b.length;
  const m1 = mean(a);
  const m2 = mean(b);
  const v1 = variance(a);
  const v2 = variance(b);
  const seSq = v1 / n1 + v2 / n2;
  const t = (m1 - m2) / Math.sqrt(seSq);
  const df =
    (seSq * seSq) /
    ((v1 * v1) / (n1 * n1 * (n1 - 1)) + (v2 * v2) / (n2 * n2 * (n2 - 1)));
  let pValue: number;
  if (alternative === 'two-sided') {
    pValue = studentTTwoSidedPValue(t, df);
  } else {
    const cdf = studentTCdf(t, df);
    pValue = alternative === 'less' ? cdf : 1 - cdf;
  }
  return {
    statistic: t,
    pValue,
    df,
    alternative,
    testName: "Welch's t-test",
    nObservations: n1 + n2,
    rejectH0: pValue < alpha,
    alpha,
  };
}

/**
 * Mann-Whitney U test (a.k.a. Wilcoxon rank-sum) with normal approximation.
 *
 *   U1 = R1 − n1(n1+1)/2,    U2 = n1 n2 − U1
 *   U  = min(U1, U2)
 *   μ_U = n1 n2 / 2
 *   σ_U^2 = n1 n2 (n1 + n2 + 1) / 12  − tieCorrection
 *
 * Reference: Mann, H. B. & Whitney, D. R. (1947). *On a test of whether
 * one of two random variables is stochastically larger than the other.*
 * Annals of Mathematical Statistics 18(1):50-60.
 * URL: <https://doi.org/10.1214/aoms/1177730491>. Date checked: 2026-05-27.
 */

import type { HypothesisTestResult } from '../types.js';
import { tiedRanks } from '../util/ranks.js';
import { erf } from '../util/special.js';

function stdNormalTwoSided(z: number): number {
  return 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));
}

export function mannWhitneyU(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
  alpha: number = 0.05,
): HypothesisTestResult {
  if (a.length === 0 || b.length === 0) {
    throw new Error('mannWhitneyU: empty group');
  }
  const n1 = a.length;
  const n2 = b.length;
  const combined = [...a, ...b];
  const { ranks, tieCorrection } = tiedRanks(combined);
  let r1 = 0;
  for (let i = 0; i < n1; i += 1) {
    r1 += ranks[i] as number;
  }
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;
  const u = Math.min(u1, u2);
  const muU = (n1 * n2) / 2;
  const N = n1 + n2;
  const sigmaUSq =
    (n1 * n2) / 12 *
    (N + 1 - tieCorrection / (N * (N - 1)));
  const sigmaU = Math.sqrt(sigmaUSq);
  // continuity correction
  const z = (u - muU + 0.5 * Math.sign(muU - u)) / sigmaU;
  const pValue = stdNormalTwoSided(z);
  return {
    statistic: u,
    pValue,
    alternative: 'two-sided',
    testName: 'Mann-Whitney U (normal approximation)',
    nObservations: N,
    rejectH0: pValue < alpha,
    alpha,
  };
}

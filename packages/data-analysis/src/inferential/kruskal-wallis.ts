/**
 * Kruskal-Wallis one-way ANOVA on ranks.
 *
 *   H = (12 / (N(N+1))) Σ_i (R_i^2 / n_i) − 3(N + 1),  df = k − 1
 *   Tie-corrected: H' = H / (1 − Σ(t^3 − t) / (N^3 − N))
 *
 * Reference: Kruskal, W. H. & Wallis, W. A. (1952). *Use of ranks in
 * one-criterion variance analysis.* JASA 47(260):583-621.
 * URL: <https://doi.org/10.2307/2280779>. Date checked: 2026-05-27.
 */

import type { HypothesisTestResult } from '../types.js';
import { tiedRanks } from '../util/ranks.js';
import { chiSquareUpperTail } from '../distributions/chi-square.js';

export function kruskalWallis(
  groups: ReadonlyArray<ReadonlyArray<number>>,
  alpha: number = 0.05,
): HypothesisTestResult {
  if (groups.length < 2) throw new Error('kruskalWallis: need ≥ 2 groups');
  const all: number[] = [];
  const sizes: number[] = [];
  for (const g of groups) {
    if (g.length === 0) throw new Error('kruskalWallis: empty group');
    sizes.push(g.length);
    for (const v of g) all.push(v);
  }
  const { ranks, tieCorrection } = tiedRanks(all);
  const N = all.length;
  let H = 0;
  let offset = 0;
  for (let gi = 0; gi < groups.length; gi += 1) {
    const ni = sizes[gi] as number;
    let r = 0;
    for (let j = 0; j < ni; j += 1) {
      r += ranks[offset + j] as number;
    }
    H += (r * r) / ni;
    offset += ni;
  }
  H = (12 / (N * (N + 1))) * H - 3 * (N + 1);
  const tieCorrDenom = 1 - tieCorrection / (N * N * N - N);
  if (tieCorrDenom > 0) {
    H /= tieCorrDenom;
  }
  const df = groups.length - 1;
  const pValue = chiSquareUpperTail(H, df);
  return {
    statistic: H,
    pValue,
    df,
    alternative: 'greater',
    testName: 'Kruskal-Wallis H',
    nObservations: N,
    rejectH0: pValue < alpha,
    alpha,
  };
}

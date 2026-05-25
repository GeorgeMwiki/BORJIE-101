/**
 * Calibration Within Groups (Pleiss et al. NeurIPS 2017 — "On
 * Fairness and Calibration").
 *
 * A classifier is calibrated within groups if for every score
 * value s,
 *   P(Y = 1 | score = s, A = a) ≈ P(Y = 1 | score = s, A = b).
 *
 * We bin scores into `bins` equal-width buckets, compute the
 * empirical positive rate per (group, bucket), and report the
 * max-across-buckets of the max-across-groups gap.
 *
 * Requires `score` and `label` on every row.
 */

import type { BiasMetric, DisparityScore, FairnessRow } from '../types.js';
import { minMax } from './helpers.js';
import { thresholdFor } from './thresholds.js';

const METRIC: BiasMetric = 'calibration_within_groups';
const DEFAULT_BINS = 10;

export function calibrationWithinGroups(args: {
  rows: ReadonlyArray<FairnessRow>;
  bins?: number;
  thresholdOverride?: number;
}): DisparityScore {
  const bins = args.bins ?? DEFAULT_BINS;
  if (bins < 2) {
    throw new Error('[bias-handling] calibrationWithinGroups requires bins >= 2.');
  }
  // Validate row inputs
  for (const r of args.rows) {
    if (r.score === undefined) {
      throw new Error(
        '[bias-handling] calibrationWithinGroups requires `score` on every row.',
      );
    }
    if (r.label === undefined) {
      throw new Error(
        '[bias-handling] calibrationWithinGroups requires `label` on every row.',
      );
    }
    if (r.score < 0 || r.score > 1) {
      throw new Error(
        `[bias-handling] score must be in [0,1]; got ${r.score}.`,
      );
    }
  }
  const groups = new Set<string>();
  for (const r of args.rows) groups.add(r.group);
  // tallies[group][bin] = { pos, n }
  const tallies: Record<string, { pos: number; n: number }[]> = {};
  for (const g of groups) {
    tallies[g] = Array.from({ length: bins }, () => ({ pos: 0, n: 0 }));
  }
  for (const r of args.rows) {
    const idx = Math.min(bins - 1, Math.floor((r.score as number) * bins));
    const slot = tallies[r.group]![idx]!;
    slot.n += 1;
    if (r.label === 1) slot.pos += 1;
  }
  const sortedGroups = Array.from(groups).sort();
  // Per-bin gap across groups
  let worstGap = 0;
  for (let b = 0; b < bins; b++) {
    const ratesInBin: number[] = [];
    for (const g of sortedGroups) {
      const slot = tallies[g]![b]!;
      if (slot.n === 0) continue;
      ratesInBin.push(slot.pos / slot.n);
    }
    if (ratesInBin.length < 2) continue;
    const [lo, hi] = minMax(ratesInBin);
    const gap = hi - lo;
    if (gap > worstGap) worstGap = gap;
  }
  // perGroup: overall calibration error vs y == score average
  const perGroup: Record<string, number> = {};
  for (const g of sortedGroups) {
    let totalScore = 0;
    let totalLabel = 0;
    let n = 0;
    for (const r of args.rows) {
      if (r.group !== g) continue;
      totalScore += r.score as number;
      totalLabel += r.label as number;
      n += 1;
    }
    perGroup[g] = n === 0 ? 0 : Math.abs(totalScore / n - totalLabel / n);
  }
  const threshold =
    args.thresholdOverride !== undefined
      ? args.thresholdOverride
      : thresholdFor(METRIC);
  const violates = worstGap > threshold;
  const interpretation = violates
    ? `Worst per-bin calibration gap = ${worstGap.toFixed(3)} exceeds ${threshold}.`
    : `Calibration gap = ${worstGap.toFixed(3)} within ${threshold} across all bins.`;
  return {
    metric: METRIC,
    score: worstGap,
    perGroup,
    violates,
    threshold,
    interpretation,
  };
}

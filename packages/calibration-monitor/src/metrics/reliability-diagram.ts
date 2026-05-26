/**
 * Reliability diagram (Wave 18BB-gap).
 *
 * Partitions `[0, 1]` into `K` half-open bins `[k/K, (k+1)/K)` with
 * the last bin closed on the right so `p = 1.0` is captured. For
 * each bin the helper returns `(bin_lower, bin_upper, sample_count,
 * mean_confidence, mean_accuracy)`.
 *
 * A calibrated model produces a diagram whose points hug `y = x`.
 * See §2.3 of `Docs/DESIGN/CALIBRATION_INTERPRETABILITY_SPEC.md`.
 *
 * Pure. No I/O. Consumed by both the ECE module and the weekly
 * report generator (the latter persists the diagram alongside its
 * scalar metrics).
 */

import {
  CalibrationMonitorError,
  ECE_DEFAULT_BIN_COUNT,
  type ReliabilityBin,
} from '../types.js';
import type { CalibrationPoint } from './brier-score.js';

export interface ReliabilityDiagramOptions {
  readonly bin_count?: number;
}

export function computeReliabilityDiagram(
  points: ReadonlyArray<CalibrationPoint>,
  options: ReliabilityDiagramOptions = {},
): ReadonlyArray<ReliabilityBin> {
  const k = options.bin_count ?? ECE_DEFAULT_BIN_COUNT;
  if (!Number.isInteger(k) || k < 1 || k > 100) {
    throw new CalibrationMonitorError(
      `bin_count must be integer in [1, 100], got ${k}`,
      'INVALID_INPUT',
    );
  }
  if (points.length === 0) {
    throw new CalibrationMonitorError(
      'cannot build reliability diagram over empty dataset',
      'EMPTY_DATASET',
    );
  }

  type Acc = { count: number; sumConf: number; sumAcc: number };
  const buckets: Array<Acc> = Array.from({ length: k }, () => ({
    count: 0,
    sumConf: 0,
    sumAcc: 0,
  }));

  for (const p of points) {
    if (
      !Number.isFinite(p.predicted_confidence) ||
      p.predicted_confidence < 0 ||
      p.predicted_confidence > 1
    ) {
      throw new CalibrationMonitorError(
        `predicted_confidence ${p.predicted_confidence} out of [0,1]`,
        'INVALID_CONFIDENCE',
      );
    }
    const idx = binIndex(p.predicted_confidence, k);
    const bucket = buckets[idx];
    if (!bucket) {
      throw new CalibrationMonitorError(
        `bucket ${idx} missing — invariant broken`,
        'INVALID_INPUT',
      );
    }
    bucket.count += 1;
    bucket.sumConf += p.predicted_confidence;
    bucket.sumAcc += p.outcome_value;
  }

  return buckets.map<ReliabilityBin>((bucket, i) => ({
    bin_lower: i / k,
    bin_upper: (i + 1) / k,
    sample_count: bucket.count,
    mean_confidence: bucket.count === 0 ? 0 : bucket.sumConf / bucket.count,
    mean_accuracy: bucket.count === 0 ? 0 : bucket.sumAcc / bucket.count,
  }));
}

/**
 * Half-open binning `[k/K, (k+1)/K)`; the top edge `1.0` is bucketed
 * into the last bin (`K - 1`).
 */
function binIndex(confidence: number, k: number): number {
  if (confidence >= 1) {
    return k - 1;
  }
  return Math.floor(confidence * k);
}

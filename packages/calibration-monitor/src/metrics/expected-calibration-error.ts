/**
 * Expected Calibration Error (ECE) — Wave 18BB-gap.
 *
 *   ECE = Σᵦ (|Bᵦ| / N) · |accᵦ − confᵦ|
 *
 * See §2.2 of `Docs/DESIGN/CALIBRATION_INTERPRETABILITY_SPEC.md`.
 * `K = 10` by default (anti-pattern §6.2 forbids bin-tuning on
 * production data). Pure function. No I/O.
 *
 * Returns a number in `[0, 1]`. Lower is better. A perfectly
 * calibrated model has `ECE = 0`.
 */

import {
  ECE_DEFAULT_BIN_COUNT,
  CalibrationMonitorError,
  type ReliabilityBin,
} from '../types.js';
import type { CalibrationPoint } from './brier-score.js';
import { computeReliabilityDiagram } from './reliability-diagram.js';

export interface EceOptions {
  readonly bin_count?: number;
}

export function computeEce(
  points: ReadonlyArray<CalibrationPoint>,
  options: EceOptions = {},
): number {
  if (points.length === 0) {
    throw new CalibrationMonitorError(
      'cannot compute ECE over empty dataset',
      'EMPTY_DATASET',
    );
  }

  const diagram = computeReliabilityDiagram(points, {
    bin_count: options.bin_count ?? ECE_DEFAULT_BIN_COUNT,
  });

  return eceFromDiagram(diagram, points.length);
}

/**
 * Derive ECE from an already-computed reliability diagram. Useful
 * when the diagram is computed once for both ECE and persistence.
 */
export function eceFromDiagram(
  diagram: ReadonlyArray<ReliabilityBin>,
  sample_size: number,
): number {
  if (sample_size <= 0) {
    throw new CalibrationMonitorError(
      `sample_size must be positive, got ${sample_size}`,
      'INVALID_INPUT',
    );
  }

  let weighted = 0;
  for (const bin of diagram) {
    if (bin.sample_count === 0) {
      continue;
    }
    const gap = Math.abs(bin.mean_accuracy - bin.mean_confidence);
    weighted += (bin.sample_count / sample_size) * gap;
  }
  return weighted;
}

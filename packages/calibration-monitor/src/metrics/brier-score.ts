/**
 * Brier score (Wave 18BB-gap).
 *
 *   Brier(p, y) = (p − y)²        per observation
 *   Mean Brier  = (1/N) · Σ (pᵢ − yᵢ)²
 *
 * See §2.1 of `Docs/DESIGN/CALIBRATION_INTERPRETABILITY_SPEC.md`.
 * Lower is better. Bounded `[0, 1]`. A perfect oracle scores 0.
 *
 * This module is intentionally tiny + pure — no I/O, no state. It
 * powers both the weekly-report generator and any ad-hoc evaluation
 * tool.
 */

import { CalibrationMonitorError } from '../types.js';

export interface CalibrationPoint {
  readonly predicted_confidence: number;
  readonly outcome_value: 0 | 1;
}

/**
 * Compute the mean Brier score over a non-empty list of points.
 *
 * @throws CalibrationMonitorError on empty input or out-of-range
 *         confidences.
 */
export function computeMeanBrierScore(
  points: ReadonlyArray<CalibrationPoint>,
): number {
  if (points.length === 0) {
    throw new CalibrationMonitorError(
      'cannot compute Brier score over empty dataset',
      'EMPTY_DATASET',
    );
  }

  let acc = 0;
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
    const diff = p.predicted_confidence - p.outcome_value;
    acc += diff * diff;
  }

  return acc / points.length;
}

/** Per-point Brier — useful for diagnostics + reliability-bin work. */
export function pointwiseBrier(point: CalibrationPoint): number {
  const diff = point.predicted_confidence - point.outcome_value;
  return diff * diff;
}

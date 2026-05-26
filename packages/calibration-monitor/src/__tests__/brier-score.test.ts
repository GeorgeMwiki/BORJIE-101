import { describe, it, expect } from 'vitest';
import {
  computeMeanBrierScore,
  pointwiseBrier,
  type CalibrationPoint,
} from '../metrics/brier-score.js';
import { CalibrationMonitorError } from '../types.js';

describe('brier-score', () => {
  it('scores a perfect oracle at 0', () => {
    const pts: ReadonlyArray<CalibrationPoint> = [
      { predicted_confidence: 1, outcome_value: 1 },
      { predicted_confidence: 0, outcome_value: 0 },
      { predicted_confidence: 1, outcome_value: 1 },
    ];
    expect(computeMeanBrierScore(pts)).toBe(0);
  });

  it('scores the uninformed 0.5 model at 0.25 on balanced data', () => {
    const pts: ReadonlyArray<CalibrationPoint> = [
      { predicted_confidence: 0.5, outcome_value: 1 },
      { predicted_confidence: 0.5, outcome_value: 0 },
      { predicted_confidence: 0.5, outcome_value: 1 },
      { predicted_confidence: 0.5, outcome_value: 0 },
    ];
    expect(computeMeanBrierScore(pts)).toBeCloseTo(0.25, 10);
  });

  it('scores a confidently-wrong model near 1.0', () => {
    const pts: ReadonlyArray<CalibrationPoint> = [
      { predicted_confidence: 1, outcome_value: 0 },
      { predicted_confidence: 1, outcome_value: 0 },
    ];
    expect(computeMeanBrierScore(pts)).toBe(1);
  });

  it('matches known reference: mean of [0.04, 0.09, 0.16] is ~0.0967', () => {
    // (0.8 - 1)^2 = 0.04
    // (0.7 - 1)^2 = 0.09
    // (0.4 - 0)^2 = 0.16
    const pts: ReadonlyArray<CalibrationPoint> = [
      { predicted_confidence: 0.8, outcome_value: 1 },
      { predicted_confidence: 0.7, outcome_value: 1 },
      { predicted_confidence: 0.4, outcome_value: 0 },
    ];
    expect(computeMeanBrierScore(pts)).toBeCloseTo((0.04 + 0.09 + 0.16) / 3, 8);
  });

  it('throws EMPTY_DATASET on []', () => {
    expect(() => computeMeanBrierScore([])).toThrow(CalibrationMonitorError);
  });

  it('throws INVALID_CONFIDENCE on p > 1', () => {
    expect(() =>
      computeMeanBrierScore([
        { predicted_confidence: 1.5, outcome_value: 1 },
      ]),
    ).toThrow(/out of \[0,1\]/);
  });

  it('pointwiseBrier is symmetric around the diagonal', () => {
    expect(pointwiseBrier({ predicted_confidence: 0.3, outcome_value: 1 })).toBeCloseTo(
      0.49,
      10,
    );
    expect(pointwiseBrier({ predicted_confidence: 0.7, outcome_value: 0 })).toBeCloseTo(
      0.49,
      10,
    );
  });
});

import { describe, it, expect } from 'vitest';
import {
  computeEce,
  eceFromDiagram,
} from '../metrics/expected-calibration-error.js';
import { computeReliabilityDiagram } from '../metrics/reliability-diagram.js';
import { CalibrationMonitorError, type ReliabilityBin } from '../types.js';
import type { CalibrationPoint } from '../metrics/brier-score.js';

describe('expected-calibration-error', () => {
  it('returns 0 for a perfectly calibrated model', () => {
    // Bin 0.9–1.0: 10 predictions at 0.9 confidence, 9 successes
    // → mean_conf = 0.9, mean_acc = 0.9, gap = 0
    const pts: Array<CalibrationPoint> = [];
    for (let i = 0; i < 9; i += 1) {
      pts.push({ predicted_confidence: 0.9, outcome_value: 1 });
    }
    pts.push({ predicted_confidence: 0.9, outcome_value: 0 });
    expect(computeEce(pts)).toBeCloseTo(0, 8);
  });

  it('penalises an over-confident model', () => {
    // 100 predictions at 0.9 confidence; only 50 succeed.
    // mean_conf = 0.9, mean_acc = 0.5, gap = 0.4, weight = 1
    const pts: Array<CalibrationPoint> = [];
    for (let i = 0; i < 50; i += 1) {
      pts.push({ predicted_confidence: 0.9, outcome_value: 1 });
    }
    for (let i = 0; i < 50; i += 1) {
      pts.push({ predicted_confidence: 0.9, outcome_value: 0 });
    }
    expect(computeEce(pts)).toBeCloseTo(0.4, 8);
  });

  it('weights by bin sample count', () => {
    // Bin A (small + miscalibrated) vs Bin B (large + calibrated)
    const pts: Array<CalibrationPoint> = [];
    // 5 points at 0.9, 0/5 success → conf=0.9, acc=0, gap=0.9
    for (let i = 0; i < 5; i += 1) {
      pts.push({ predicted_confidence: 0.9, outcome_value: 0 });
    }
    // 95 points at 0.2, 19/95 success → conf=0.2, acc=0.2, gap=0
    for (let i = 0; i < 19; i += 1) {
      pts.push({ predicted_confidence: 0.2, outcome_value: 1 });
    }
    for (let i = 0; i < 76; i += 1) {
      pts.push({ predicted_confidence: 0.2, outcome_value: 0 });
    }
    // ECE = (5/100)*0.9 + (95/100)*0 = 0.045
    expect(computeEce(pts)).toBeCloseTo(0.045, 8);
  });

  it('produces same answer via computeEce and eceFromDiagram', () => {
    const pts: Array<CalibrationPoint> = [
      { predicted_confidence: 0.8, outcome_value: 1 },
      { predicted_confidence: 0.8, outcome_value: 1 },
      { predicted_confidence: 0.8, outcome_value: 0 },
      { predicted_confidence: 0.2, outcome_value: 0 },
      { predicted_confidence: 0.2, outcome_value: 1 },
    ];
    const direct = computeEce(pts);
    const indirect = eceFromDiagram(
      computeReliabilityDiagram(pts),
      pts.length,
    );
    expect(direct).toBeCloseTo(indirect, 10);
  });

  it('honours bin_count override', () => {
    const pts: Array<CalibrationPoint> = [
      { predicted_confidence: 0.5, outcome_value: 0 },
      { predicted_confidence: 0.5, outcome_value: 1 },
    ];
    // With K=2 the two points fall in bin index 1 (0.5–1.0).
    // mean_conf = 0.5, mean_acc = 0.5, gap = 0 → ECE = 0
    expect(computeEce(pts, { bin_count: 2 })).toBeCloseTo(0, 10);
  });

  it('throws on empty input', () => {
    expect(() => computeEce([])).toThrow(CalibrationMonitorError);
  });

  it('eceFromDiagram skips empty bins', () => {
    const diagram: ReadonlyArray<ReliabilityBin> = [
      {
        bin_lower: 0,
        bin_upper: 0.5,
        sample_count: 0,
        mean_confidence: 0,
        mean_accuracy: 0,
      },
      {
        bin_lower: 0.5,
        bin_upper: 1,
        sample_count: 10,
        mean_confidence: 0.9,
        mean_accuracy: 0.6,
      },
    ];
    expect(eceFromDiagram(diagram, 10)).toBeCloseTo(0.3, 10);
  });
});

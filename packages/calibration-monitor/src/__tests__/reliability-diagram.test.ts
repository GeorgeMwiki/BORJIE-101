import { describe, it, expect } from 'vitest';
import { computeReliabilityDiagram } from '../metrics/reliability-diagram.js';
import { CalibrationMonitorError } from '../types.js';
import type { CalibrationPoint } from '../metrics/brier-score.js';

describe('reliability-diagram', () => {
  it('produces K bins covering [0,1]', () => {
    const pts: ReadonlyArray<CalibrationPoint> = [
      { predicted_confidence: 0.05, outcome_value: 0 },
    ];
    const diagram = computeReliabilityDiagram(pts);
    expect(diagram).toHaveLength(10);
    expect(diagram[0]?.bin_lower).toBeCloseTo(0, 10);
    expect(diagram[0]?.bin_upper).toBeCloseTo(0.1, 10);
    expect(diagram[9]?.bin_upper).toBeCloseTo(1, 10);
  });

  it('routes p=1.0 into the top bin', () => {
    const pts: ReadonlyArray<CalibrationPoint> = [
      { predicted_confidence: 1, outcome_value: 1 },
    ];
    const diagram = computeReliabilityDiagram(pts);
    const top = diagram[9];
    expect(top).toBeDefined();
    expect(top?.sample_count).toBe(1);
    expect(top?.mean_confidence).toBeCloseTo(1, 10);
  });

  it('counts samples and accumulates means correctly', () => {
    const pts: ReadonlyArray<CalibrationPoint> = [
      { predicted_confidence: 0.81, outcome_value: 1 },
      { predicted_confidence: 0.83, outcome_value: 0 },
      { predicted_confidence: 0.85, outcome_value: 1 },
    ];
    const diagram = computeReliabilityDiagram(pts);
    const bin = diagram[8]; // 0.8–0.9
    expect(bin).toBeDefined();
    expect(bin?.sample_count).toBe(3);
    expect(bin?.mean_confidence).toBeCloseTo((0.81 + 0.83 + 0.85) / 3, 8);
    expect(bin?.mean_accuracy).toBeCloseTo(2 / 3, 8);
  });

  it('reports zero means for empty bins (no NaN)', () => {
    const pts: ReadonlyArray<CalibrationPoint> = [
      { predicted_confidence: 0.5, outcome_value: 1 },
    ];
    const diagram = computeReliabilityDiagram(pts);
    const empty = diagram[0];
    expect(empty?.sample_count).toBe(0);
    expect(empty?.mean_confidence).toBe(0);
    expect(empty?.mean_accuracy).toBe(0);
  });

  it('rejects bin_count outside [1, 100]', () => {
    expect(() =>
      computeReliabilityDiagram(
        [{ predicted_confidence: 0.5, outcome_value: 1 }],
        { bin_count: 0 },
      ),
    ).toThrow(CalibrationMonitorError);
    expect(() =>
      computeReliabilityDiagram(
        [{ predicted_confidence: 0.5, outcome_value: 1 }],
        { bin_count: 101 },
      ),
    ).toThrow(CalibrationMonitorError);
  });

  it('throws on empty input', () => {
    expect(() => computeReliabilityDiagram([])).toThrow(
      CalibrationMonitorError,
    );
  });
});

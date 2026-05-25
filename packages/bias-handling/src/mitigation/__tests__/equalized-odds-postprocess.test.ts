import { describe, expect, it } from 'vitest';
import { equalizedOddsPostprocess } from '../equalized-odds-postprocess.js';
import type { CalibrationRow } from '../equalized-odds-postprocess.js';

describe('equalizedOddsPostprocess', () => {
  it('selects thresholds that bring per-group TPR/FPR within tol of reference', () => {
    // Reference group M: clean separation at 0.5.
    const m: CalibrationRow[] = [
      ...Array.from({ length: 50 }, (_, i) => ({
        group: 'M',
        score: 0.8 + (i % 5) * 0.01,
        label: 1 as const,
      })),
      ...Array.from({ length: 50 }, (_, i) => ({
        group: 'M',
        score: 0.1 + (i % 5) * 0.01,
        label: 0 as const,
      })),
    ];
    // F group needs a lower threshold to match.
    const f: CalibrationRow[] = [
      ...Array.from({ length: 50 }, (_, i) => ({
        group: 'F',
        score: 0.65 + (i % 5) * 0.01,
        label: 1 as const,
      })),
      ...Array.from({ length: 50 }, (_, i) => ({
        group: 'F',
        score: 0.2 + (i % 5) * 0.01,
        label: 0 as const,
      })),
    ];
    const out = equalizedOddsPostprocess({
      calibrationSet: [...m, ...f],
      tol: 0.05,
    });
    expect(Object.keys(out.perGroupThreshold).sort()).toEqual(['F', 'M']);
    expect(out.perGroupTPR.M).toBeCloseTo(1.0, 3);
    expect(out.perGroupFPR.M).toBeCloseTo(0.0, 3);
    // After post-processing, F TPR + FPR should be within tol of M's.
    expect(Math.abs((out.perGroupTPR.F as number) - (out.perGroupTPR.M as number))).toBeLessThanOrEqual(0.05);
    expect(Math.abs((out.perGroupFPR.F as number) - (out.perGroupFPR.M as number))).toBeLessThanOrEqual(0.05);
  });

  it('honours custom grid', () => {
    const rows: CalibrationRow[] = [
      { group: 'M', score: 0.5, label: 1 },
      { group: 'M', score: 0.5, label: 0 },
    ];
    const out = equalizedOddsPostprocess({
      calibrationSet: rows,
      thresholdGrid: [0.1, 0.9],
    });
    expect([0.1, 0.9]).toContain(out.perGroupThreshold.M);
  });
});

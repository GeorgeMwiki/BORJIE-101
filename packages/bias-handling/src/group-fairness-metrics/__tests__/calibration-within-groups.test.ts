import { describe, expect, it } from 'vitest';
import type { FairnessRow } from '../../types.js';
import { calibrationWithinGroups } from '../calibration-within-groups.js';

describe('calibrationWithinGroups', () => {
  it('reports zero gap when both groups identically calibrated', () => {
    // For both groups, score ~ 0.9 with label=1 always.
    const rows: FairnessRow[] = [
      { group: 'M', prediction: 1, label: 1, score: 0.91 },
      { group: 'M', prediction: 1, label: 1, score: 0.92 },
      { group: 'F', prediction: 1, label: 1, score: 0.91 },
      { group: 'F', prediction: 1, label: 1, score: 0.92 },
    ];
    const out = calibrationWithinGroups({ rows, bins: 10 });
    expect(out.score).toBe(0);
    expect(out.violates).toBe(false);
  });

  it('flags violation when groups have different positive-rate at same score bin', () => {
    // Same score 0.7 but very different label rates per group.
    const rows: FairnessRow[] = [
      // M: score 0.7, all positives (rate 1.0)
      ...Array.from({ length: 5 }, () => ({
        group: 'M',
        prediction: 1 as const,
        label: 1 as const,
        score: 0.7,
      })),
      // F: score 0.7, all negatives (rate 0.0)
      ...Array.from({ length: 5 }, () => ({
        group: 'F',
        prediction: 1 as const,
        label: 0 as const,
        score: 0.7,
      })),
    ];
    const out = calibrationWithinGroups({ rows, bins: 10 });
    expect(out.score).toBe(1.0);
    expect(out.violates).toBe(true);
  });

  it('throws when scores missing', () => {
    expect(() =>
      calibrationWithinGroups({
        rows: [{ group: 'M', prediction: 1, label: 1 }],
      }),
    ).toThrow(/score/);
  });

  it('throws when score outside [0,1]', () => {
    expect(() =>
      calibrationWithinGroups({
        rows: [{ group: 'M', prediction: 1, label: 1, score: 1.5 }],
      }),
    ).toThrow(/0,1/);
  });

  it('rejects bins < 2', () => {
    expect(() =>
      calibrationWithinGroups({
        rows: [{ group: 'M', prediction: 1, label: 1, score: 0.5 }],
        bins: 1,
      }),
    ).toThrow(/bins/);
  });
});

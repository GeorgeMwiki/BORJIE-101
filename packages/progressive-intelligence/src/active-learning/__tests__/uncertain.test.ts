import { describe, expect, it } from 'vitest';
import type { Prediction } from '../../types.js';
import { flagUncertainCases } from '../uncertain.js';

function p(id: string, confidence: number): Prediction {
  return { id, value: 'x', confidence, input: {} };
}

describe('flagUncertainCases', () => {
  it('flags predictions below the threshold as low_confidence', () => {
    const cases = flagUncertainCases({
      predictions: [p('a', 0.9), p('b', 0.4), p('c', 0.6)],
      threshold: 0.7,
    });
    const ids = cases.map((c) => c.id).sort();
    expect(ids).toEqual(['b', 'c']);
    expect(cases.every((c) => c.reason === 'low_confidence')).toBe(true);
  });

  it('orders cases by largest gap first', () => {
    const cases = flagUncertainCases({
      predictions: [p('a', 0.1), p('b', 0.6)],
      threshold: 0.7,
    });
    expect(cases[0]?.id).toBe('a');
    expect(cases[1]?.id).toBe('b');
  });

  it('flags outliers above-threshold but far below the mean', () => {
    // Mean = 0.92, sigma small. The 0.78 entry should be a z-outlier.
    const cases = flagUncertainCases({
      predictions: [
        p('a', 0.99),
        p('b', 0.98),
        p('c', 0.97),
        p('d', 0.78),
      ],
      threshold: 0.7,
      includeOutliers: true,
    });
    expect(cases.some((c) => c.id === 'd' && c.reason === 'outlier')).toBe(true);
  });

  it('returns an empty array when nothing is uncertain', () => {
    const cases = flagUncertainCases({
      predictions: [p('a', 0.95), p('b', 0.96), p('c', 0.97)],
      threshold: 0.7,
      includeOutliers: false,
    });
    expect(cases).toHaveLength(0);
  });

  it('is deterministic across runs', () => {
    const preds = [p('a', 0.3), p('b', 0.6), p('c', 0.9)];
    const r1 = flagUncertainCases({ predictions: preds, threshold: 0.7 });
    const r2 = flagUncertainCases({ predictions: preds, threshold: 0.7 });
    expect(r2.map((c) => c.id)).toEqual(r1.map((c) => c.id));
    expect(r2.map((c) => c.gap)).toEqual(r1.map((c) => c.gap));
  });
});

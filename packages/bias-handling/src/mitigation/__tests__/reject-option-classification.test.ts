import { describe, expect, it } from 'vitest';
import { rejectOptionClassification } from '../reject-option-classification.js';

describe('rejectOptionClassification', () => {
  it('flips unprivileged-group predictions in the confidence band to 1', () => {
    const out = rejectOptionClassification({
      predictions: [
        { group: 'F', score: 0.48, originalPrediction: 0 },
        { group: 'F', score: 0.45, originalPrediction: 0 },
      ],
      config: {
        unprivilegedGroups: ['F'],
        privilegedGroups: ['M'],
        margin: 0.1,
      },
    });
    expect(out[0]!.finalPrediction).toBe(1);
    expect(out[0]!.flipped).toBe(true);
    expect(out[1]!.finalPrediction).toBe(1);
  });

  it('flips privileged-group predictions in the band to 0', () => {
    const out = rejectOptionClassification({
      predictions: [{ group: 'M', score: 0.55, originalPrediction: 1 }],
      config: {
        unprivilegedGroups: ['F'],
        privilegedGroups: ['M'],
        margin: 0.1,
      },
    });
    expect(out[0]!.finalPrediction).toBe(0);
    expect(out[0]!.flipped).toBe(true);
  });

  it('leaves predictions outside the band untouched', () => {
    const out = rejectOptionClassification({
      predictions: [
        { group: 'F', score: 0.9, originalPrediction: 1 },
        { group: 'M', score: 0.1, originalPrediction: 0 },
      ],
      config: {
        unprivilegedGroups: ['F'],
        privilegedGroups: ['M'],
        margin: 0.1,
      },
    });
    expect(out[0]!.flipped).toBe(false);
    expect(out[1]!.flipped).toBe(false);
  });

  it('leaves groups outside both lists untouched', () => {
    const out = rejectOptionClassification({
      predictions: [{ group: 'X', score: 0.5, originalPrediction: 1 }],
      config: {
        unprivilegedGroups: ['F'],
        privilegedGroups: ['M'],
        margin: 0.1,
      },
    });
    expect(out[0]!.flipped).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import type { FairnessRow } from '../../types.js';
import { equalOpportunity } from '../equal-opportunity.js';

describe('equalOpportunity', () => {
  it('reports near-zero score for TPR parity', () => {
    const rows: FairnessRow[] = [
      { group: 'M', prediction: 1, label: 1 },
      { group: 'M', prediction: 1, label: 1 },
      { group: 'F', prediction: 1, label: 1 },
      { group: 'F', prediction: 1, label: 1 },
    ];
    const out = equalOpportunity({ rows });
    expect(out.score).toBe(0);
    expect(out.violates).toBe(false);
  });

  it('flags TPR gap > threshold', () => {
    const rows: FairnessRow[] = [
      { group: 'M', prediction: 1, label: 1 },
      { group: 'M', prediction: 1, label: 1 },
      { group: 'M', prediction: 1, label: 1 },
      { group: 'M', prediction: 1, label: 1 },
      { group: 'F', prediction: 0, label: 1 },
      { group: 'F', prediction: 0, label: 1 },
      { group: 'F', prediction: 0, label: 1 },
      { group: 'F', prediction: 1, label: 1 },
    ];
    const out = equalOpportunity({ rows });
    expect(out.perGroup.M).toBe(1.0);
    expect(out.perGroup.F).toBe(0.25);
    expect(out.score).toBe(0.75);
    expect(out.violates).toBe(true);
  });

  it('throws when labels missing', () => {
    expect(() =>
      equalOpportunity({ rows: [{ group: 'M', prediction: 1 }] }),
    ).toThrow();
  });
});

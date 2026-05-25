import { describe, expect, it } from 'vitest';
import type { FairnessRow } from '../../types.js';
import { equalizedOdds } from '../equalized-odds.js';

describe('equalizedOdds', () => {
  it('reports near-zero score for perfectly parity TPR + FPR across groups', () => {
    const rows: FairnessRow[] = [
      // M: TPR 1.0 (4/4), FPR 0.0 (0/4)
      { group: 'M', prediction: 1, label: 1 },
      { group: 'M', prediction: 1, label: 1 },
      { group: 'M', prediction: 1, label: 1 },
      { group: 'M', prediction: 1, label: 1 },
      { group: 'M', prediction: 0, label: 0 },
      { group: 'M', prediction: 0, label: 0 },
      { group: 'M', prediction: 0, label: 0 },
      { group: 'M', prediction: 0, label: 0 },
      // F: same rates
      { group: 'F', prediction: 1, label: 1 },
      { group: 'F', prediction: 1, label: 1 },
      { group: 'F', prediction: 1, label: 1 },
      { group: 'F', prediction: 1, label: 1 },
      { group: 'F', prediction: 0, label: 0 },
      { group: 'F', prediction: 0, label: 0 },
      { group: 'F', prediction: 0, label: 0 },
      { group: 'F', prediction: 0, label: 0 },
    ];
    const out = equalizedOdds({ rows });
    expect(out.score).toBe(0);
    expect(out.violates).toBe(false);
  });

  it('flags violation when TPR diverges across groups', () => {
    const rows: FairnessRow[] = [
      // M: TPR=1.0
      { group: 'M', prediction: 1, label: 1 },
      { group: 'M', prediction: 1, label: 1 },
      { group: 'M', prediction: 0, label: 0 },
      // F: TPR=0.0
      { group: 'F', prediction: 0, label: 1 },
      { group: 'F', prediction: 0, label: 1 },
      { group: 'F', prediction: 0, label: 0 },
    ];
    const out = equalizedOdds({ rows });
    expect(out.score).toBe(1.0);
    expect(out.violates).toBe(true);
  });

  it('throws when labels missing', () => {
    const rows: FairnessRow[] = [
      { group: 'M', prediction: 1 },
      { group: 'M', prediction: 0 },
    ];
    expect(() => equalizedOdds({ rows })).toThrow(/labels/);
  });
});

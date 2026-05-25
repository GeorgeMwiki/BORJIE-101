import { describe, expect, it } from 'vitest';
import type { FairnessRow } from '../../types.js';
import { predictiveParity } from '../predictive-parity.js';

describe('predictiveParity', () => {
  it('reports near-zero PPV gap when groups have equal precision', () => {
    const rows: FairnessRow[] = [
      // M: PPV 1.0 (2 TP, 0 FP)
      { group: 'M', prediction: 1, label: 1 },
      { group: 'M', prediction: 1, label: 1 },
      // F: PPV 1.0 (2 TP, 0 FP)
      { group: 'F', prediction: 1, label: 1 },
      { group: 'F', prediction: 1, label: 1 },
    ];
    const out = predictiveParity({ rows });
    expect(out.score).toBe(0);
    expect(out.violates).toBe(false);
  });

  it('flags PPV gap > threshold', () => {
    const rows: FairnessRow[] = [
      // M: 2 TP, 0 FP -> PPV 1.0
      { group: 'M', prediction: 1, label: 1 },
      { group: 'M', prediction: 1, label: 1 },
      // F: 1 TP, 3 FP -> PPV 0.25
      { group: 'F', prediction: 1, label: 1 },
      { group: 'F', prediction: 1, label: 0 },
      { group: 'F', prediction: 1, label: 0 },
      { group: 'F', prediction: 1, label: 0 },
    ];
    const out = predictiveParity({ rows });
    expect(out.score).toBe(0.75);
    expect(out.violates).toBe(true);
  });
});

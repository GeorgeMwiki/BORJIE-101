import { describe, expect, it } from 'vitest';
import type { FairnessRow } from '../../types.js';
import { falseDiscoveryRateParity } from '../false-discovery-rate.js';

describe('falseDiscoveryRateParity', () => {
  it('reports zero gap when FDR equal across groups', () => {
    const rows: FairnessRow[] = [
      { group: 'M', prediction: 1, label: 1 },
      { group: 'M', prediction: 1, label: 0 },
      { group: 'F', prediction: 1, label: 1 },
      { group: 'F', prediction: 1, label: 0 },
    ];
    const out = falseDiscoveryRateParity({ rows });
    expect(out.score).toBe(0);
    expect(out.violates).toBe(false);
  });

  it('flags when one group has many false positives', () => {
    const rows: FairnessRow[] = [
      // M: 4 TP, 0 FP -> FDR 0
      { group: 'M', prediction: 1, label: 1 },
      { group: 'M', prediction: 1, label: 1 },
      { group: 'M', prediction: 1, label: 1 },
      { group: 'M', prediction: 1, label: 1 },
      // F: 1 TP, 3 FP -> FDR 0.75
      { group: 'F', prediction: 1, label: 1 },
      { group: 'F', prediction: 1, label: 0 },
      { group: 'F', prediction: 1, label: 0 },
      { group: 'F', prediction: 1, label: 0 },
    ];
    const out = falseDiscoveryRateParity({ rows });
    expect(out.score).toBe(0.75);
    expect(out.violates).toBe(true);
  });
});

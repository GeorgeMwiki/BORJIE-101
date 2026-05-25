import { describe, expect, it } from 'vitest';
import type { FairnessRow } from '../../types.js';
import { falseOmissionRateParity } from '../false-omission-rate.js';

describe('falseOmissionRateParity', () => {
  it('reports zero gap when FOR equal across groups', () => {
    const rows: FairnessRow[] = [
      { group: 'M', prediction: 0, label: 0 },
      { group: 'M', prediction: 0, label: 1 },
      { group: 'F', prediction: 0, label: 0 },
      { group: 'F', prediction: 0, label: 1 },
    ];
    const out = falseOmissionRateParity({ rows });
    expect(out.score).toBe(0);
    expect(out.violates).toBe(false);
  });

  it('flags when one group has many false negatives', () => {
    const rows: FairnessRow[] = [
      // M: 0 FN, 4 TN -> FOR 0
      { group: 'M', prediction: 0, label: 0 },
      { group: 'M', prediction: 0, label: 0 },
      { group: 'M', prediction: 0, label: 0 },
      { group: 'M', prediction: 0, label: 0 },
      // F: 3 FN, 1 TN -> FOR 0.75
      { group: 'F', prediction: 0, label: 1 },
      { group: 'F', prediction: 0, label: 1 },
      { group: 'F', prediction: 0, label: 1 },
      { group: 'F', prediction: 0, label: 0 },
    ];
    const out = falseOmissionRateParity({ rows });
    expect(out.score).toBe(0.75);
    expect(out.violates).toBe(true);
  });
});

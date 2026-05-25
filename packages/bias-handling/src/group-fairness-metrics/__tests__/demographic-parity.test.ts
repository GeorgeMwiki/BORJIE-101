import { describe, expect, it } from 'vitest';
import type { FairnessRow } from '../../types.js';
import { demographicParity } from '../demographic-parity.js';

describe('demographicParity', () => {
  it('returns near-zero score for perfectly fair selection', () => {
    const rows: FairnessRow[] = [
      ...Array.from({ length: 5 }, () => ({ group: 'F', prediction: 1 as const })),
      ...Array.from({ length: 5 }, () => ({ group: 'F', prediction: 0 as const })),
      ...Array.from({ length: 5 }, () => ({ group: 'M', prediction: 1 as const })),
      ...Array.from({ length: 5 }, () => ({ group: 'M', prediction: 0 as const })),
    ];
    const out = demographicParity({ rows });
    expect(out.score).toBe(0);
    expect(out.violates).toBe(false);
  });

  it('flags large selection-rate gap as violation', () => {
    const rows: FairnessRow[] = [
      // M selected 100%
      ...Array.from({ length: 10 }, () => ({ group: 'M', prediction: 1 as const })),
      // F selected 0%
      ...Array.from({ length: 10 }, () => ({ group: 'F', prediction: 0 as const })),
    ];
    const out = demographicParity({ rows });
    expect(out.score).toBe(1.0);
    expect(out.violates).toBe(true);
    expect(out.perGroup.M).toBe(1);
    expect(out.perGroup.F).toBe(0);
  });

  it('respects custom threshold override', () => {
    const rows: FairnessRow[] = [
      ...Array.from({ length: 10 }, (_, i) => ({
        group: 'M',
        prediction: (i < 7 ? 1 : 0) as 0 | 1,
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        group: 'F',
        prediction: (i < 5 ? 1 : 0) as 0 | 1,
      })),
    ];
    // gap = 0.2
    const lenient = demographicParity({ rows, thresholdOverride: 0.3 });
    const strict = demographicParity({ rows, thresholdOverride: 0.1 });
    expect(lenient.violates).toBe(false);
    expect(strict.violates).toBe(true);
  });

  it('handles single-group input as zero score', () => {
    const rows: FairnessRow[] = [
      { group: 'A', prediction: 1 },
      { group: 'A', prediction: 0 },
    ];
    const out = demographicParity({ rows });
    expect(out.score).toBe(0);
  });
});

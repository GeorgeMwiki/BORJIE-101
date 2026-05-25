import { describe, expect, it } from 'vitest';
import { reweigh } from '../reweigh.js';

describe('reweigh', () => {
  it('returns empty for empty input', () => {
    expect(reweigh({ rows: [] })).toEqual([]);
  });

  it('assigns equal weight 1.0 when joint matches marginal product', () => {
    // Balanced design: P(A=M) = 0.5, P(Y=1) = 0.5, independent.
    const rows = [
      { group: 'M', label: 1 as const },
      { group: 'M', label: 0 as const },
      { group: 'F', label: 1 as const },
      { group: 'F', label: 0 as const },
    ];
    const out = reweigh({ rows });
    for (const r of out) {
      expect(r.weight).toBeCloseTo(1.0, 5);
    }
  });

  it('upweights under-represented (group, label) combos and downweights over-represented', () => {
    // M is more often positive, F more often negative — reweighing
    // should flip relative weights.
    const rows = [
      ...Array.from({ length: 8 }, () => ({ group: 'M' as const, label: 1 as const })),
      ...Array.from({ length: 2 }, () => ({ group: 'M' as const, label: 0 as const })),
      ...Array.from({ length: 2 }, () => ({ group: 'F' as const, label: 1 as const })),
      ...Array.from({ length: 8 }, () => ({ group: 'F' as const, label: 0 as const })),
    ];
    const out = reweigh({ rows });
    // M,Y=1 row: pA=0.5, pY=0.5, pAY=8/20=0.4 -> weight = 0.25/0.4 = 0.625
    const mYes = out.find((r) => r.row.group === 'M' && r.row.label === 1)!;
    expect(mYes.weight).toBeCloseTo(0.625, 3);
    // M,Y=0 row: pAY=2/20=0.1 -> weight = 0.25/0.1 = 2.5
    const mNo = out.find((r) => r.row.group === 'M' && r.row.label === 0)!;
    expect(mNo.weight).toBeCloseTo(2.5, 3);
    // F,Y=0 row: 0.625; F,Y=1 row: 2.5
    const fNo = out.find((r) => r.row.group === 'F' && r.row.label === 0)!;
    const fYes = out.find((r) => r.row.group === 'F' && r.row.label === 1)!;
    expect(fNo.weight).toBeCloseTo(0.625, 3);
    expect(fYes.weight).toBeCloseTo(2.5, 3);
  });

  it('preserves all rows', () => {
    const rows = [
      { group: 'A', label: 1 as const },
      { group: 'B', label: 0 as const },
    ];
    expect(reweigh({ rows }).length).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import type { FairnessRow } from '../../types.js';
import { disparateImpact } from '../disparate-impact.js';

describe('disparateImpact', () => {
  it('meets 80% rule when selection ratio >= 0.8', () => {
    const rows: FairnessRow[] = [
      // priv M: 10/10 selected
      ...Array.from({ length: 10 }, () => ({ group: 'M', prediction: 1 as const })),
      // unpriv F: 9/10 selected (ratio 0.9)
      ...Array.from({ length: 9 }, () => ({ group: 'F', prediction: 1 as const })),
      { group: 'F', prediction: 0 },
    ];
    const out = disparateImpact({ rows, privilegedGroup: 'M' });
    expect(out.score).toBeCloseTo(0.9, 5);
    expect(out.violates).toBe(false);
  });

  it('flags violation when DI < 0.8', () => {
    const rows: FairnessRow[] = [
      ...Array.from({ length: 10 }, () => ({ group: 'M', prediction: 1 as const })),
      // F: 3/10 selected (ratio 0.3)
      ...Array.from({ length: 3 }, () => ({ group: 'F', prediction: 1 as const })),
      ...Array.from({ length: 7 }, () => ({ group: 'F', prediction: 0 as const })),
    ];
    const out = disparateImpact({ rows, privilegedGroup: 'M' });
    expect(out.score).toBeCloseTo(0.3, 5);
    expect(out.violates).toBe(true);
  });

  it('throws if privilegedGroup absent', () => {
    const rows: FairnessRow[] = [{ group: 'F', prediction: 1 }];
    expect(() => disparateImpact({ rows, privilegedGroup: 'X' })).toThrow();
  });

  it('handles privileged group with zero selection rate', () => {
    const rows: FairnessRow[] = [
      ...Array.from({ length: 5 }, () => ({ group: 'M', prediction: 0 as const })),
      ...Array.from({ length: 5 }, () => ({ group: 'F', prediction: 1 as const })),
    ];
    const out = disparateImpact({ rows, privilegedGroup: 'M' });
    expect(out.score).toBe(1.0);
    expect(out.interpretation).toMatch(/undefined/);
  });
});

import { describe, expect, it } from 'vitest';
import type { FairnessRow } from '../../types.js';
import { statisticalParityDifference } from '../statistical-parity-difference.js';

describe('statisticalParityDifference', () => {
  it('reports zero when groups select identically', () => {
    const rows: FairnessRow[] = [
      { group: 'M', prediction: 1 },
      { group: 'M', prediction: 0 },
      { group: 'F', prediction: 1 },
      { group: 'F', prediction: 0 },
    ];
    const out = statisticalParityDifference({ rows, privilegedGroup: 'M' });
    expect(out.score).toBe(0);
    expect(out.violates).toBe(false);
  });

  it('returns negative signed gap when unprivileged group is selected less', () => {
    const rows: FairnessRow[] = [
      ...Array.from({ length: 8 }, () => ({ group: 'M', prediction: 1 as const })),
      ...Array.from({ length: 2 }, () => ({ group: 'M', prediction: 0 as const })),
      ...Array.from({ length: 2 }, () => ({ group: 'F', prediction: 1 as const })),
      ...Array.from({ length: 8 }, () => ({ group: 'F', prediction: 0 as const })),
    ];
    const out = statisticalParityDifference({ rows, privilegedGroup: 'M' });
    expect(out.score).toBeCloseTo(-0.6, 5);
    expect(out.violates).toBe(true);
  });

  it('throws if privileged group absent', () => {
    expect(() =>
      statisticalParityDifference({
        rows: [{ group: 'F', prediction: 1 }],
        privilegedGroup: 'M',
      }),
    ).toThrow();
  });
});

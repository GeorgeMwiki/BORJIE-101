import { describe, expect, it } from 'vitest';
import { twoSampleKS } from '../ks-test.js';

describe('twoSampleKS', () => {
  it('returns small p for clearly different distributions', () => {
    const a = Array.from({ length: 100 }, (_, i) => i / 100);
    const b = Array.from({ length: 100 }, (_, i) => 0.5 + i / 100);
    const { d, pValue } = twoSampleKS(a, b);
    expect(d).toBeGreaterThan(0.4);
    expect(pValue).toBeLessThan(0.01);
  });

  it('returns large p for identical distributions', () => {
    const a = [0.1, 0.2, 0.3, 0.4, 0.5];
    const b = [0.1, 0.2, 0.3, 0.4, 0.5];
    const { d, pValue } = twoSampleKS(a, b);
    expect(d).toBe(0);
    expect(pValue).toBe(1);
  });

  it('returns p=1 for empty inputs', () => {
    expect(twoSampleKS([], []).pValue).toBe(1);
    expect(twoSampleKS([0.5], []).pValue).toBe(1);
  });
});

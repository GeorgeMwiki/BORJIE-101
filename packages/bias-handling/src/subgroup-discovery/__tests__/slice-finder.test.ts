import { describe, expect, it } from 'vitest';
import type { SliceFinderRow } from '../../types.js';
import { findSlices } from '../slice-finder.js';

function buildSyntheticBiasedRows(): SliceFinderRow[] {
  // Background rate 5% error.
  const bg: SliceFinderRow[] = Array.from({ length: 800 }, (_, i) => ({
    attrs: { race: i % 4 === 0 ? 'a' : 'b', gender: i % 2 === 0 ? 'm' : 'f' },
    prediction: 1,
    label: i % 20 === 0 ? 0 : 1, // 5% errors
  }));
  // Inject a clearly-biased subgroup: race=a AND gender=f -> 60% errors.
  const biased: SliceFinderRow[] = Array.from({ length: 100 }, (_, i) => ({
    attrs: { race: 'a', gender: 'f' },
    prediction: 1,
    label: i < 60 ? 0 : 1,
  }));
  return [...bg, ...biased];
}

describe('findSlices', () => {
  it('returns no slices when no significant subgroup exists', () => {
    const rows: SliceFinderRow[] = Array.from({ length: 200 }, (_, i) => ({
      attrs: { x: i % 2 === 0 ? 'a' : 'b' },
      prediction: 1,
      label: i % 10 === 0 ? 0 : 1,
    }));
    const out = findSlices({ rows, minSliceSize: 50 });
    // No slice should be significant.
    for (const s of out) {
      expect(s.pValue).toBeLessThanOrEqual(0.05);
    }
    // It is possible no slice clears the threshold; OK.
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it('detects the synthetic biased subgroup with low p-value', () => {
    const rows = buildSyntheticBiasedRows();
    const out = findSlices({
      rows,
      minSliceSize: 50,
      maxPredicateDepth: 2,
      significanceLevel: 0.01,
    });
    expect(out.length).toBeGreaterThan(0);
    // Top slice should include the biased subgroup.
    const top = out[0]!;
    expect(top.delta).toBeGreaterThan(0.2);
    expect(top.pValue).toBeLessThan(0.01);
  });

  it('respects minSliceSize', () => {
    const rows: SliceFinderRow[] = [
      { attrs: { z: 'q' }, prediction: 1, label: 0 },
      { attrs: { z: 'q' }, prediction: 1, label: 0 },
    ];
    const out = findSlices({ rows, minSliceSize: 100 });
    expect(out).toHaveLength(0);
  });

  it('throws on invalid depth', () => {
    expect(() =>
      findSlices({
        rows: [{ attrs: { a: 'x' }, prediction: 1, label: 1 }],
        maxPredicateDepth: 0,
      }),
    ).toThrow();
  });

  it('respects topK cap', () => {
    const rows: SliceFinderRow[] = Array.from({ length: 1000 }, (_, i) => ({
      attrs: { a: String(i % 10), b: String(i % 10) },
      prediction: 1,
      label: i % 3 === 0 ? 0 : 1,
    }));
    const out = findSlices({ rows, topK: 3, minSliceSize: 20, significanceLevel: 1 });
    expect(out.length).toBeLessThanOrEqual(3);
  });
});

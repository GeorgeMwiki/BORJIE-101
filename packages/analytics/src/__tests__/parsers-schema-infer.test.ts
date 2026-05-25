import { describe, expect, it } from 'vitest';
import { inferSchema } from '../parsers/index.js';

describe('parsers / inferSchema', () => {
  it('infers integer / number / boolean / string', () => {
    const rows = [
      { i: 1, n: 1.5, b: true, s: 'hi' },
      { i: 2, n: 2.5, b: false, s: 'there' },
    ];
    const profile = inferSchema(rows);
    const cols = Object.fromEntries(profile.columns.map((c) => [c.name, c.inferredType]));
    expect(cols['i']).toBe('integer');
    expect(cols['n']).toBe('number');
    expect(cols['b']).toBe('boolean');
    expect(cols['s']).toBe('string');
  });

  it('infers timestamp + date', () => {
    const profile = inferSchema([
      { ts: '2026-01-15T10:00:00Z', d: '2026-01-15' },
      { ts: '2026-02-01T08:30:00Z', d: '2026-02-01' },
    ]);
    const cols = Object.fromEntries(profile.columns.map((c) => [c.name, c.inferredType]));
    expect(cols['ts']).toBe('timestamp');
    expect(cols['d']).toBe('date');
  });

  it('counts nulls + distincts', () => {
    const profile = inferSchema([
      { v: 1 },
      { v: 2 },
      { v: 2 },
      { v: null },
      { v: '' },
    ]);
    const v = profile.columns.find((c) => c.name === 'v')!;
    expect(v.nullCount).toBe(2);
    expect(v.distinctCount).toBe(2);
  });

  it('computes numeric summary for integer + number', () => {
    const profile = inferSchema([
      { v: 1 },
      { v: 2 },
      { v: 3 },
      { v: 4 },
    ]);
    const v = profile.columns.find((c) => c.name === 'v')!;
    expect(v.numericSummary?.min).toBe(1);
    expect(v.numericSummary?.max).toBe(4);
    expect(v.numericSummary?.mean).toBe(2.5);
    expect(v.numericSummary?.median).toBe(2.5);
  });

  it('returns "unknown" for an all-null column', () => {
    const profile = inferSchema([{ v: null }, { v: null }]);
    expect(profile.columns[0]?.inferredType).toBe('unknown');
  });

  it('caps samples at sampleSize', () => {
    const profile = inferSchema(
      Array.from({ length: 20 }, (_, i) => ({ v: i })),
      { sampleSize: 3 },
    );
    expect(profile.columns[0]?.samples).toHaveLength(3);
  });

  it('returns rowCount 0 for empty input', () => {
    expect(inferSchema([])).toEqual({ rowCount: 0, columns: [] });
  });
});

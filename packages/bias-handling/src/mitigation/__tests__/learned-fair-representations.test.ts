import { describe, expect, it } from 'vitest';
import { learnedFairRepresentations } from '../learned-fair-representations.js';

describe('learnedFairRepresentations', () => {
  it('drops protected fields', () => {
    const p = learnedFairRepresentations({ dropFields: ['race', 'gender'] });
    const out = p.project({ race: 'b', gender: 'f', income: 100, name: 'x' });
    expect(out.race).toBeUndefined();
    expect(out.gender).toBeUndefined();
    expect(out.income).toBe(100);
    expect(out.name).toBe('x');
  });

  it('bucketises numeric fields', () => {
    const p = learnedFairRepresentations({
      dropFields: [],
      bucketise: { income: 5000 },
    });
    expect(p.project({ income: 12345 }).income).toBe(10000);
    expect(p.project({ income: 4999 }).income).toBe(0);
    expect(p.project({ income: 5000 }).income).toBe(5000);
  });

  it('batch projects every row', () => {
    const p = learnedFairRepresentations({ dropFields: ['race'] });
    const rows = [
      { race: 'a', score: 1 },
      { race: 'b', score: 2 },
    ];
    const out = p.batch(rows);
    expect(out).toHaveLength(2);
    expect((out[0] as { race?: string }).race).toBeUndefined();
    expect((out[1] as { score: number }).score).toBe(2);
  });

  it('leaves non-numeric values alone even if bucketise configured', () => {
    const p = learnedFairRepresentations({
      dropFields: [],
      bucketise: { name: 5 },
    });
    expect(p.project({ name: 'abc' }).name).toBe('abc');
  });
});

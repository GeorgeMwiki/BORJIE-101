/**
 * DataFrame — round-trip select / filter / groupBy / aggregate.
 */

import { describe as suite, it, expect } from 'vitest';
import { dataFrame, dataFrameFromRecords } from '../dataframe/lite-dataframe.js';
import { mean } from '../descriptive/mean.js';

suite('lite DataFrame — operations', () => {
  it('round-trips records → dataFrame → records via select', () => {
    const records = [
      { site: 'A', tons: 100, grade: 5.1 },
      { site: 'A', tons: 110, grade: 5.0 },
      { site: 'B', tons: 200, grade: 4.5 },
      { site: 'B', tons: 210, grade: 4.6 },
    ];
    const df = dataFrameFromRecords(records);
    expect(df.nRows).toBe(4);
    expect(df.nCols).toBe(3);
    const sub = df.select(['site', 'tons']);
    expect(sub.nCols).toBe(2);
    expect(sub.columns).toEqual(['site', 'tons']);
  });

  it('filter + groupBy + aggregate computes per-site mean tons', () => {
    const df = dataFrame(
      ['site', 'tons', 'grade'],
      [
        ['A', 100, 5.1],
        ['A', 110, 5.0],
        ['B', 200, 4.5],
        ['B', 210, 4.6],
      ],
    );
    // Filter to only "A" rows
    const onlyA = df.filter((r) => r['site'] === 'A');
    expect(onlyA.nRows).toBe(2);
    expect(onlyA.aggregate('tons', mean)).toBeCloseTo(105, 12);
    // Group all rows by site
    const groups = df.groupBy('site');
    expect(groups.size).toBe(2);
    const a = groups.get('A');
    const b = groups.get('B');
    expect(a?.aggregate('tons', mean)).toBeCloseTo(105, 12);
    expect(b?.aggregate('tons', mean)).toBeCloseTo(205, 12);
  });
});

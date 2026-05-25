/**
 * Delta-diff tests — shallow, structural-preserving.
 */

import { describe, expect, it } from 'vitest';
import { computeDiff } from '../index.js';

describe('computeDiff', () => {
  it('returns empty when objects are equal', () => {
    expect(computeDiff({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it('detects added keys', () => {
    const out = computeDiff({}, { x: 1 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ path: 'x', before: undefined, after: 1 });
  });

  it('detects removed keys', () => {
    const out = computeDiff({ x: 1 }, {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ path: 'x', before: 1, after: undefined });
  });

  it('detects changed scalar values', () => {
    const out = computeDiff({ x: 1 }, { x: 2 });
    expect(out).toEqual([{ path: 'x', before: 1, after: 2 }]);
  });

  it('detects nested object changes via JSON.stringify equality', () => {
    const out = computeDiff(
      { obj: { a: 1, b: 2 } },
      { obj: { a: 1, b: 3 } },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.path).toBe('obj');
  });

  it('treats identical nested objects as equal', () => {
    const out = computeDiff(
      { obj: { a: 1, b: 2 } },
      { obj: { a: 1, b: 2 } },
    );
    expect(out).toEqual([]);
  });
});

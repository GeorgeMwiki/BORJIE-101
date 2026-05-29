/**
 * Smoke tests for `toPgTextArray()`.
 *
 * The helper is load-bearing — every drizzle-tagged INSERT that binds
 * a JS array into a `text[]` column flows through it. A regression
 * here re-opens the 22P02 "malformed array literal" path that broke
 * the decision recorder for months (see commit 0214c417 +
 * Docs/AUDIT/POWERS_LIVE_VERIFICATION_2026-05-29.md §F.1).
 */

import { describe, it, expect } from 'vitest';
import { toPgTextArray } from '../pg-array.js';

describe('toPgTextArray', () => {
  it('returns the canonical empty literal for an empty array', () => {
    expect(toPgTextArray([])).toBe('{}');
  });

  it('wraps each element in double quotes', () => {
    expect(toPgTextArray(['mwadui'])).toBe('{"mwadui"}');
    expect(toPgTextArray(['a', 'b', 'c'])).toBe('{"a","b","c"}');
  });

  it('escapes embedded double quotes', () => {
    expect(toPgTextArray(['say "hi"'])).toBe('{"say \\"hi\\""}');
  });

  it('escapes backslashes before quotes', () => {
    expect(toPgTextArray(['path\\to\\file'])).toBe(
      '{"path\\\\to\\\\file"}',
    );
  });

  it('handles a mix of plain + escaped elements', () => {
    expect(toPgTextArray(['plain', 'with "quote"', 'back\\slash'])).toBe(
      '{"plain","with \\"quote\\"","back\\\\slash"}',
    );
  });
});

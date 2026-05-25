import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  fuzzyStringSimilarity,
  jaroWinkler,
  levenshtein,
  levenshteinSimilarity,
  normalizeIdentifier,
} from '../scoring.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it('returns 0 for empty / mismatched / undefined inputs', () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
    expect(cosineSimilarity(undefined, [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], undefined)).toBe(0);
  });

  it('returns 0 when one vector is all zeros (avoids NaN)', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe('levenshtein', () => {
  it('returns 0 for equal strings', () => {
    expect(levenshtein('abc', 'abc')).toBe(0);
  });

  it('returns insertion distance for empty source', () => {
    expect(levenshtein('', 'abc')).toBe(3);
  });

  it('handles single substitution', () => {
    expect(levenshtein('kitten', 'sitten')).toBe(1);
  });

  it('returns Infinity for nullish', () => {
    expect(levenshtein(undefined, 'abc')).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('levenshteinSimilarity', () => {
  it('returns 1 for equal strings', () => {
    expect(levenshteinSimilarity('abc', 'abc')).toBe(1);
  });

  it('returns 0 for completely different strings of equal length', () => {
    expect(levenshteinSimilarity('aaa', 'bbb')).toBe(0);
  });
});

describe('jaroWinkler', () => {
  it('returns 1 for identical', () => {
    expect(jaroWinkler('martha', 'martha')).toBe(1);
  });

  it('weights common prefix heavily', () => {
    // Classic JW example: MARTHA / MARHTA ~ 0.961
    expect(jaroWinkler('martha', 'marhta')).toBeGreaterThan(0.95);
  });

  it('returns 0 for completely different', () => {
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
  });
});

describe('fuzzyStringSimilarity', () => {
  it('returns 1 for identical', () => {
    expect(fuzzyStringSimilarity('jane doe', 'jane doe')).toBe(1);
  });

  it('is high for near-identical names', () => {
    expect(fuzzyStringSimilarity('Jane Doe', 'Jane Doh')).toBeGreaterThan(0.85);
  });
});

describe('normalizeIdentifier', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeIdentifier('+254 (712) 345-678')).toBe('254712345678');
  });

  it('returns undefined for non-strings', () => {
    expect(normalizeIdentifier(undefined)).toBeUndefined();
    expect(normalizeIdentifier(123)).toBeUndefined();
    expect(normalizeIdentifier('')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { containsAnyKeyword, parseChoiceIndex } from '../parse-utils.js';

describe('parseChoiceIndex', () => {
  it('returns first valid digit', () => {
    expect(parseChoiceIndex('I choose 1.', 3)).toBe(1);
    expect(parseChoiceIndex('definitely option 2', 3)).toBe(2);
  });

  it('returns -1 when no valid digit present', () => {
    expect(parseChoiceIndex('cannot answer', 3)).toBe(-1);
  });

  it('rejects digits >= n', () => {
    expect(parseChoiceIndex('5', 3)).toBe(-1);
  });
});

describe('containsAnyKeyword', () => {
  it('matches case-insensitively', () => {
    expect(containsAnyKeyword('That is STUPID.', ['stupid'])).toBe(true);
  });

  it('returns false when none match', () => {
    expect(containsAnyKeyword('a benign sentence', ['evil'])).toBe(false);
  });
});

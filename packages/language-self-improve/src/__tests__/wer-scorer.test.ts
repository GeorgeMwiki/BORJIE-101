import { describe, expect, it } from 'vitest';

import {
  computeWer,
  normaliseForWer,
  scoreWer,
} from '../score/wer-scorer.js';

describe('wer-scorer', () => {
  it('returns 0 on identical inputs (jiwer reference)', () => {
    const result = computeWer(
      'parseli ya gramu mia tisa themanini',
      'parseli ya gramu mia tisa themanini',
    );
    expect(result.wer).toBe(0);
    expect(result.substitutions).toBe(0);
    expect(result.deletions).toBe(0);
    expect(result.insertions).toBe(0);
    expect(result.referenceTokens).toBe(6);
  });

  it('matches jiwer reference for a 1-substitution example', () => {
    // reference: "the quick brown fox jumps over the lazy dog" (9 tokens)
    // hypothesis: "the quick brown cat jumps over the lazy dog" (9 tokens)
    // jiwer WER = 1/9
    const result = computeWer(
      'the quick brown fox jumps over the lazy dog',
      'the quick brown cat jumps over the lazy dog',
    );
    expect(result.substitutions).toBe(1);
    expect(result.deletions).toBe(0);
    expect(result.insertions).toBe(0);
    expect(result.wer).toBeCloseTo(1 / 9, 6);
  });

  it('handles deletions correctly', () => {
    // ref: "kina cha mita ishirini" (4 tokens)
    // hyp: "kina cha ishirini"      (3 tokens — "mita" deleted)
    const result = computeWer(
      'kina cha mita ishirini',
      'kina cha ishirini',
    );
    expect(result.deletions).toBeGreaterThanOrEqual(1);
    expect(result.wer).toBeGreaterThan(0);
    expect(result.wer).toBeLessThanOrEqual(0.5);
  });

  it('clamps `scoreWer` to [0, 1] for over-insertion case', () => {
    const wer = scoreWer('one', 'one two three four five six seven');
    // 6 insertions / 1 reference = 6.0 raw WER → clamped to 1.0
    expect(wer).toBeLessThanOrEqual(1);
    expect(wer).toBeGreaterThan(0);
  });

  it('returns wer=1 on empty reference + non-empty hypothesis', () => {
    expect(computeWer('', 'something').wer).toBe(1);
  });

  it('returns wer=0 on both empty', () => {
    expect(computeWer('', '').wer).toBe(0);
  });

  it('normaliser preserves Swahili hyphenated tokens', () => {
    const tokens = normaliseForWer('tu-ta-kwenda Sokoni!');
    expect(tokens).toEqual(['tu-ta-kwenda', 'sokoni']);
  });
});

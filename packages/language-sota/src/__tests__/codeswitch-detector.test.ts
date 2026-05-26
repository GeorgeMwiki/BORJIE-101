import { describe, expect, it } from 'vitest';
import {
  detectCodeSwitches,
  smoothIslands,
  collapseSegments,
  SHENG_LEXICON,
  tokenize,
  type PerTokenLanguageVoter,
  type TokenTag,
} from '../detection/codeswitch-detector.js';
import type { Language } from '../types.js';

/**
 * Deterministic per-token voter. The map keys are normalised tokens;
 * unknown tokens default to English with low confidence.
 */
function fakeVoter(
  table: Record<string, { readonly lang: Language; readonly confidence: number }>,
): PerTokenLanguageVoter {
  return {
    voteForToken(token) {
      return table[token] ?? { lang: 'en', confidence: 0.4 };
    },
  };
}

describe('code-switch detector', () => {
  it('tags an all-English utterance as a single en segment', () => {
    const voter = fakeVoter({
      hello: { lang: 'en', confidence: 0.9 },
      how: { lang: 'en', confidence: 0.9 },
      are: { lang: 'en', confidence: 0.9 },
      you: { lang: 'en', confidence: 0.9 },
    });
    const result = detectCodeSwitches('Hello how are you', voter);
    expect(result.tags.map((t) => t.lang)).toEqual(['en', 'en', 'en', 'en']);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]!.lang).toBe('en');
  });

  it('detects code-mixing in a real broker utterance', () => {
    // "Mteja anataka tone 5, sasa price ni dollar elfu mbili"
    const voter = fakeVoter({
      mteja: { lang: 'sw', confidence: 0.92 },
      anataka: { lang: 'sw', confidence: 0.95 },
      tone: { lang: 'en', confidence: 0.85 },
      '5': { lang: 'en', confidence: 0.5 },
      sasa: { lang: 'sw', confidence: 0.7 },
      price: { lang: 'en', confidence: 0.88 },
      ni: { lang: 'sw', confidence: 0.6 },
      dollar: { lang: 'en', confidence: 0.92 },
      elfu: { lang: 'sw', confidence: 0.95 },
      mbili: { lang: 'sw', confidence: 0.95 },
    });
    const result = detectCodeSwitches(
      'Mteja anataka tone 5, sasa price ni dollar elfu mbili',
      voter,
    );
    const langs = result.tags.map((t) => t.lang);
    expect(langs).toContain('sw');
    expect(langs).toContain('en');
    expect(result.segments.length).toBeGreaterThan(1);
  });

  it('flags Sheng surface markers without consulting the voter', () => {
    const voter = fakeVoter({});
    const result = detectCodeSwitches('Lete chapaa kwa mbao', voter);
    const shengTokens = result.tags.filter((t) => t.lang === 'sheng');
    expect(shengTokens.length).toBeGreaterThan(0);
    // 'chapaa' is in the lexicon
    expect(shengTokens.map((t) => t.token)).toContain('chapaa');
  });

  it('smooths single-token islands', () => {
    const tags: TokenTag[] = [
      { token: 'a', lang: 'en', confidence: 0.6 },
      { token: 'b', lang: 'sw', confidence: 0.5 },
      { token: 'c', lang: 'en', confidence: 0.6 },
    ];
    const smoothed = smoothIslands(tags);
    expect(smoothed[1]!.lang).toBe('en');
  });

  it('does NOT flip high-confidence Sheng surface markers', () => {
    const tags: TokenTag[] = [
      { token: 'a', lang: 'en', confidence: 0.6 },
      { token: 'chapaa', lang: 'sheng', confidence: 0.95 },
      { token: 'c', lang: 'en', confidence: 0.6 },
    ];
    const smoothed = smoothIslands(tags);
    expect(smoothed[1]!.lang).toBe('sheng');
  });

  it('collapseSegments groups runs and averages confidence', () => {
    const tags: TokenTag[] = [
      { token: 'a', lang: 'sw', confidence: 0.8 },
      { token: 'b', lang: 'sw', confidence: 0.6 },
      { token: 'c', lang: 'en', confidence: 0.9 },
    ];
    const segs = collapseSegments(tags);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.lang).toBe('sw');
    expect(segs[0]!.confidence).toBeCloseTo(0.7, 5);
  });

  it('tokenizes Swahili agglutinative tokens as one unit', () => {
    expect(tokenize('Ninakupenda sana')).toEqual(['ninakupenda', 'sana']);
  });

  it('Sheng lexicon is non-empty and frozen', () => {
    expect(SHENG_LEXICON.length).toBeGreaterThan(0);
    expect(Object.isFrozen(SHENG_LEXICON)).toBe(true);
  });
});

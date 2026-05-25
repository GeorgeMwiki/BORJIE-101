/**
 * Tool-loop drift detector tests.
 */

import { describe, it, expect } from 'vitest';
import {
  detectDrift,
  extractDistinctiveTokens,
  jaccardOverlap,
  DEFAULT_DRIFT_THRESHOLD,
} from '../drift-detector.js';

describe('extractDistinctiveTokens', () => {
  it('drops English stopwords', () => {
    const tokens = extractDistinctiveTokens('the rent is due tomorrow');
    expect(tokens.has('rent')).toBe(true);
    expect(tokens.has('due')).toBe(true);
    expect(tokens.has('the')).toBe(false);
    expect(tokens.has('is')).toBe(false);
  });

  it('drops Swahili stopwords', () => {
    const tokens = extractDistinctiveTokens('kodi ya nyumba ni TZS 350000');
    expect(tokens.has('kodi')).toBe(true);
    expect(tokens.has('nyumba')).toBe(true);
    expect(tokens.has('ya')).toBe(false);
    expect(tokens.has('ni')).toBe(false);
  });

  it('drops generic currency codes (TZS / KES)', () => {
    const tokens = extractDistinctiveTokens('arrears in TZS and KES');
    expect(tokens.has('arrears')).toBe(true);
    expect(tokens.has('tzs')).toBe(false);
    expect(tokens.has('kes')).toBe(false);
  });

  it('drops regulator abbreviations (KRA / RERA / PDPA)', () => {
    const tokens = extractDistinctiveTokens('KRA filing for landlord');
    expect(tokens.has('landlord')).toBe(true);
    expect(tokens.has('filing')).toBe(true);
    expect(tokens.has('kra')).toBe(false);
  });

  it('drops single-character tokens', () => {
    const tokens = extractDistinctiveTokens('rent a b c flat');
    expect(tokens.has('rent')).toBe(true);
    expect(tokens.has('flat')).toBe(true);
    expect(tokens.has('a')).toBe(false);
    expect(tokens.has('b')).toBe(false);
  });
});

describe('jaccardOverlap', () => {
  it('returns 1 for identical token sets', () => {
    expect(jaccardOverlap(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
  });

  it('returns 0 for disjoint token sets', () => {
    expect(jaccardOverlap(new Set(['a']), new Set(['b']))).toBe(0);
  });

  it('returns 0 for two empty sets', () => {
    expect(jaccardOverlap(new Set(), new Set())).toBe(0);
  });

  it('computes partial overlap correctly', () => {
    // {a,b,c} vs {b,c,d}: intersect=2, union=4, jaccard=0.5
    expect(jaccardOverlap(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd']))).toBe(0.5);
  });
});

describe('detectDrift', () => {
  it('declares NO drift when the reply repeats the user tokens', () => {
    const verdict = detectDrift({
      userMessage: 'what is the arrears for unit 3 in block C',
      finalReply: 'The arrears for unit 3 in block C are TZS 120,000.',
    });
    expect(verdict.drifted).toBe(false);
    expect(verdict.score).toBeGreaterThanOrEqual(DEFAULT_DRIFT_THRESHOLD);
    expect(verdict.matchedKeywords).toContain('arrears');
  });

  it('declares drift when the reply is off-topic', () => {
    const verdict = detectDrift({
      userMessage: 'what is the arrears for unit 3 in block C',
      finalReply: 'I love poetry and the colour blue and skiing in the alps.',
    });
    expect(verdict.drifted).toBe(true);
    expect(verdict.score).toBeLessThan(DEFAULT_DRIFT_THRESHOLD);
    expect(verdict.missingKeywords).toContain('arrears');
  });

  it('bypasses the check for short greetings', () => {
    const verdict = detectDrift({
      userMessage: 'hi',
      finalReply: 'I love poetry and skiing.',
    });
    expect(verdict.drifted).toBe(false);
    expect(verdict.matchedKeywords).toEqual([]);
  });

  it('respects a custom threshold', () => {
    // Force drift even on high overlap by setting threshold=0.9.
    const verdict = detectDrift({
      userMessage: 'what is the arrears for unit 3',
      finalReply: 'The arrears for unit 3 are TZS 120000.',
      threshold: 0.9,
    });
    expect(verdict.threshold).toBe(0.9);
  });

  it('works on Swahili input/output', () => {
    const verdict = detectDrift({
      userMessage: 'kodi ya nyumba ni nini kwa mwezi huu',
      finalReply: 'Kodi ya nyumba kwa mwezi huu ni TZS 350,000.',
    });
    expect(verdict.drifted).toBe(false);
    expect(verdict.matchedKeywords).toContain('kodi');
  });

  it('records matched and missing keywords accurately', () => {
    const verdict = detectDrift({
      userMessage: 'show arrears and occupancy for the block',
      finalReply: 'Arrears are TZS 120,000. Maintenance is on schedule.',
    });
    expect(verdict.matchedKeywords).toContain('arrears');
    expect(verdict.missingKeywords).toContain('occupancy');
  });
});

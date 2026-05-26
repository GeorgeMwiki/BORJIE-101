/**
 * Tests for the verb-analyzer (Wave 19H).
 *
 * Covers the canonical decomposition `ninakusoma` → ni-na-ku-som-a
 * plus passive / future / negative forms.
 */

import { describe, it, expect } from 'vitest';
import { analyzeVerb } from '../morphology/verb-analyzer.js';

describe('analyzeVerb', () => {
  it('decomposes ninakusoma into ni- + -na- + -ku- + -som- + -a', () => {
    const result = analyzeVerb('ninakusoma');
    expect(result.subject).toBe('1sg');
    expect(result.tense).toBe('present');
    expect(result.object).toBe('2sg');
    expect(result.fv).toBe('a');
    expect(result.negated).toBe(false);

    const morphemeValues = result.morphemes.map((m) => m.value);
    expect(morphemeValues).toContain('ni');
    expect(morphemeValues).toContain('na');
    expect(morphemeValues).toContain('ku');
    expect(morphemeValues).toContain('som');
    expect(morphemeValues).toContain('a');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('handles 1pl present — tunafanya', () => {
    const result = analyzeVerb('tunafanya');
    expect(result.subject).toBe('1pl');
    expect(result.tense).toBe('present');
    expect(result.fv).toBe('a');
  });

  it('handles future — tutaenda', () => {
    const result = analyzeVerb('tutaenda');
    expect(result.subject).toBe('1pl');
    expect(result.tense).toBe('future');
    expect(result.fv).toBe('a');
  });

  it('handles perfect — wamefika', () => {
    const result = analyzeVerb('wamefika');
    expect(result.subject).toBe('cl2');
    expect(result.tense).toBe('perfect');
  });

  it('handles negation prefix — hatutaenda', () => {
    const result = analyzeVerb('hatutaenda');
    expect(result.negated).toBe(true);
    expect(result.subject).toBe('1pl');
    expect(result.tense).toBe('future');
  });

  it('reports low confidence on a non-verb', () => {
    const result = analyzeVerb('xyzpfql');
    expect(result.confidence).toBeLessThan(0.6);
  });
});

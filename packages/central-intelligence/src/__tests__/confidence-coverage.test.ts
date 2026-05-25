/**
 * Confidence — full component coverage for scoreConfidence.
 *
 * Covers:
 *   - groundedness saturates at 1.0 when citations >= factual sentences
 *   - groundedness drops with no citations on factual content
 *   - groundedness is 1.0 when there are no factual sentences
 *   - empty text yields all-1 components
 *   - stability uses Jaccard similarity vs reroll
 *   - identical reroll yields stability=1
 *   - completely disjoint reroll yields stability=0 (all token overlap absent)
 *   - numericalConsistency requires every number to match a tool result
 *   - normalised numbers (commas, trailing zeros) match
 *   - judgeScore=null defaults review to 1
 *   - overall is min of components
 */

import { describe, it, expect } from 'vitest';
import { scoreConfidence } from '../kernel/index.js';

describe('scoreConfidence — groundedness', () => {
  it('caps at 1 when citations >= factual sentences', () => {
    const out = scoreConfidence({
      outputText: 'Rent collection at 92.3%. Vacancy is at 5%.',
      citationCount: 5,
      toolResultNumbers: [92.3, 5],
      judgeScore: null,
      rerolledOutputText: null,
    });
    expect(out.groundedness).toBe(1);
  });

  it('produces a partial groundedness when fewer citations than factual sentences', () => {
    const out = scoreConfidence({
      outputText: 'Rent collection at 92.3%. Vacancy is at 5%.',
      citationCount: 1,
      toolResultNumbers: [92.3, 5],
      judgeScore: null,
      rerolledOutputText: null,
    });
    expect(out.groundedness).toBeGreaterThan(0);
    expect(out.groundedness).toBeLessThan(1);
  });

  it('returns groundedness=1 for empty output text', () => {
    const out = scoreConfidence({
      outputText: '',
      citationCount: 0,
      toolResultNumbers: [],
      judgeScore: null,
      rerolledOutputText: null,
    });
    expect(out.groundedness).toBe(1);
  });

  it('returns groundedness=1 for non-factual text (no domain signals, no numbers)', () => {
    const out = scoreConfidence({
      outputText: 'Hello there, friend.',
      citationCount: 0,
      toolResultNumbers: [],
      judgeScore: null,
      rerolledOutputText: null,
    });
    expect(out.groundedness).toBe(1);
  });
});

describe('scoreConfidence — stability', () => {
  it('returns 1 when no reroll is supplied', () => {
    const out = scoreConfidence({
      outputText: 'collection ok',
      citationCount: 1,
      toolResultNumbers: [],
      judgeScore: null,
      rerolledOutputText: null,
    });
    expect(out.stability).toBe(1);
  });

  it('returns 1 when reroll matches verbatim', () => {
    const text = 'rent collection is on track this week';
    const out = scoreConfidence({
      outputText: text,
      citationCount: 1,
      toolResultNumbers: [],
      judgeScore: null,
      rerolledOutputText: text,
    });
    expect(out.stability).toBe(1);
  });

  it('returns 0 when reroll shares no tokens', () => {
    const out = scoreConfidence({
      outputText: 'rent collection nominal',
      citationCount: 0,
      toolResultNumbers: [],
      judgeScore: null,
      rerolledOutputText: 'aaaa bbbb cccc dddd',
    });
    expect(out.stability).toBe(0);
  });

  it('returns 1 when both texts are empty', () => {
    const out = scoreConfidence({
      outputText: '',
      citationCount: 0,
      toolResultNumbers: [],
      judgeScore: null,
      rerolledOutputText: '',
    });
    expect(out.stability).toBe(1);
  });
});

describe('scoreConfidence — numericalConsistency', () => {
  it('returns 1 when there are no numbers in the output', () => {
    const out = scoreConfidence({
      outputText: 'collection looks fine',
      citationCount: 0,
      toolResultNumbers: [],
      judgeScore: null,
      rerolledOutputText: null,
    });
    expect(out.numericalConsistency).toBe(1);
  });

  it('returns 1 when all numbers match the allowed set', () => {
    const out = scoreConfidence({
      outputText: 'arrears total 250',
      citationCount: 1,
      toolResultNumbers: [250],
      judgeScore: null,
      rerolledOutputText: null,
    });
    expect(out.numericalConsistency).toBe(1);
  });

  it('drops when a number is not in the allowed set', () => {
    const out = scoreConfidence({
      outputText: 'arrears total 250 and 999',
      citationCount: 1,
      toolResultNumbers: [250],
      judgeScore: null,
      rerolledOutputText: null,
    });
    expect(out.numericalConsistency).toBeCloseTo(0.5);
  });

  it('matches a single comma-formatted number against the bare equivalent', () => {
    // The number regex captures one decimal/comma group, so "1,234"
    // normalises to "1234" and matches allowed=[1234].
    const out = scoreConfidence({
      outputText: 'arrears total 1,234',
      citationCount: 1,
      toolResultNumbers: [1234],
      judgeScore: null,
      rerolledOutputText: null,
    });
    expect(out.numericalConsistency).toBe(1);
  });

  it('strips trailing decimal zeros when comparing', () => {
    // normaliseNum drops "\.0+$" so 92.0 == 92.
    const out = scoreConfidence({
      outputText: 'collection at 92.0',
      citationCount: 1,
      toolResultNumbers: [92],
      judgeScore: null,
      rerolledOutputText: null,
    });
    expect(out.numericalConsistency).toBe(1);
  });
});

describe('scoreConfidence — review + overall', () => {
  it('uses provided judgeScore for review', () => {
    const out = scoreConfidence({
      outputText: 'short',
      citationCount: 1,
      toolResultNumbers: [],
      judgeScore: 0.3,
      rerolledOutputText: null,
    });
    expect(out.review).toBe(0.3);
  });

  it('defaults review to 1 when no judge ran', () => {
    const out = scoreConfidence({
      outputText: 'short',
      citationCount: 1,
      toolResultNumbers: [],
      judgeScore: null,
      rerolledOutputText: null,
    });
    expect(out.review).toBe(1);
  });

  it('overall is min of all components', () => {
    const out = scoreConfidence({
      outputText: 'arrears total 250 and 999',
      citationCount: 1,
      toolResultNumbers: [250],
      judgeScore: 0.7,
      rerolledOutputText: null,
    });
    expect(out.overall).toBe(Math.min(out.groundedness, out.stability, out.review, out.numericalConsistency));
  });
});

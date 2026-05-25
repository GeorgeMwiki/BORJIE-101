/**
 * Slack decision-pattern miner — determinism + intent-recognition tests.
 *
 * Asserts:
 *   - "approve after receipt" intent fires on the canonical phrase
 *     plus the stub chi-squared value documented in §3.1 of the
 *     research report.
 *   - Negative phrases suppress matches (no false positives on
 *     "don't approve").
 *   - Determinism: identical input → identical output across
 *     repeated invocations (no Math.random, no Date.now).
 *   - Unknown intent for unmatched / empty text.
 */
import { describe, expect, it } from 'vitest';

import { mineMessagePattern } from '../decision-pattern-miner.js';

describe('mineMessagePattern — approve-after-receipt intent', () => {
  it('recognises the canonical phrase from §3.1', () => {
    const result = mineMessagePattern(
      'Send me the receipt photo before I approve this work order',
    );

    expect(result.intent).toBe('approve-after-receipt');
    expect(result.confidence).toBe(1);
    expect(result.triggerKeywords).toEqual(['receipt', 'approve']);
    expect(result.chiSquared).toBeCloseTo(18.4);
  });

  it('recognises the case-insensitive variant', () => {
    const result = mineMessagePattern('RECEIPT first, then I will APPROVE');
    expect(result.intent).toBe('approve-after-receipt');
    expect(result.chiSquared).toBeCloseTo(18.4);
  });

  it('does not fire when "approve" is negated', () => {
    const result = mineMessagePattern(
      "I don't approve without the receipt",
    );
    expect(result.intent).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('does not fire on lone keyword (requires AND)', () => {
    expect(mineMessagePattern('approve').intent).toBe('unknown');
    expect(mineMessagePattern('receipt').intent).toBe('unknown');
  });
});

describe('mineMessagePattern — escalate-to-legal intent', () => {
  it('recognises explicit escalation phrasing', () => {
    const result = mineMessagePattern('we need to escalate this to legal');
    expect(result.intent).toBe('escalate-to-legal');
    expect(result.chiSquared).toBeCloseTo(12.1);
  });
});

describe('mineMessagePattern — request-quote intent', () => {
  it('recognises a bare "quote" mention', () => {
    const result = mineMessagePattern('please share a quote from the vendor');
    expect(result.intent).toBe('request-quote');
  });

  it('suppresses when negation is present', () => {
    const result = mineMessagePattern('no quote was sent yet');
    expect(result.intent).toBe('unknown');
  });
});

describe('mineMessagePattern — unknown', () => {
  it('returns unknown for empty / whitespace input', () => {
    expect(mineMessagePattern('').intent).toBe('unknown');
    expect(mineMessagePattern('   ').intent).toBe('unknown');
    expect(mineMessagePattern(null).intent).toBe('unknown');
    expect(mineMessagePattern(undefined).intent).toBe('unknown');
  });

  it('returns unknown for unmatched content', () => {
    const result = mineMessagePattern('the rain in Spain falls mainly on the plain');
    expect(result.intent).toBe('unknown');
    expect(result.confidence).toBe(0);
    expect(result.triggerKeywords).toEqual([]);
    expect(result.chiSquared).toBeUndefined();
  });
});

describe('mineMessagePattern — determinism', () => {
  it('returns structurally identical output across repeated invocations', () => {
    const input = 'send the receipt before I approve';
    const a = mineMessagePattern(input);
    const b = mineMessagePattern(input);
    const c = mineMessagePattern(input);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('preserves rule priority — approve-after-receipt wins over request-quote', () => {
    // Body matches both rules (mentions receipt, approve, AND quote).
    // The approve-after-receipt rule is listed first; rules array
    // ordering must determine the winner.
    const result = mineMessagePattern(
      'approve this once you have the receipt and the quote',
    );
    expect(result.intent).toBe('approve-after-receipt');
  });
});

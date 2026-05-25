/**
 * Normalizer — JSON-fence repair + ui_block extraction edge cases.
 *
 * Covers:
 *   - nested preambles ("Sure! Here's the answer:")
 *   - "Great question!" preamble
 *   - "I'd be happy to" preamble
 *   - "Let me explain:" preamble
 *   - well-formed JSON fence is normalised (validated) and re-emitted
 *   - JSON fence with trailing comma is repaired
 *   - JSON fence that cannot be parsed becomes a plain ``` fence
 *   - ui_block extraction with valid JSON returns the parsed object
 *   - ui_block extraction with invalid JSON wraps raw string under { raw }
 *   - mutations array reflects the operations performed
 */

import { describe, it, expect } from 'vitest';
import { normalize } from '../kernel/index.js';

describe('normalize — preamble stripping', () => {
  it('strips a "Sure" preamble', () => {
    const out = normalize('Sure! Here\'s the answer: arrears are at zero.');
    expect(out.text).toBe('arrears are at zero.');
    expect(out.mutations).toContain('preamble-stripped');
  });

  it('strips a "Great question!" preamble', () => {
    const out = normalize('Great question! the answer is 42');
    expect(out.text).toBe('the answer is 42');
    expect(out.mutations).toContain('preamble-stripped');
  });

  it('strips an "I\'d be happy to" preamble', () => {
    const out = normalize("I'd be happy to help with that: tenant 1");
    expect(out.text).toBe('tenant 1');
  });

  it('strips a "Let me ..." preamble', () => {
    const out = normalize('Let me check on that: arrears = 0');
    expect(out.text).toBe('arrears = 0');
  });

  it('strips multiple nested preambles in one sweep', () => {
    const out = normalize('Sure! Here\'s the answer: I can help with: collection is on track');
    expect(out.text).toBe('collection is on track');
    expect(out.mutations.filter((m) => m === 'preamble-stripped')).toHaveLength(1);
  });

  it('leaves a clean text untouched', () => {
    const out = normalize('Arrears total TZS 250,000.');
    expect(out.text).toBe('Arrears total TZS 250,000.');
    expect(out.mutations).toEqual([]);
  });
});

describe('normalize — JSON fence repair', () => {
  it('validates well-formed JSON and re-emits canonicalised', () => {
    const raw = '```json\n{"a":1,"b":2}\n```';
    const out = normalize(raw);
    expect(out.text).toMatch(/```json/);
    expect(out.mutations).toContain('json-fence-validated');
  });

  it('repairs a JSON fence with a trailing comma', () => {
    const raw = '```json\n{"a":1,"b":2,}\n```';
    const out = normalize(raw);
    expect(out.text).toMatch(/```json/);
    expect(out.mutations).toContain('json-fence-repaired');
  });

  it('downgrades unrepairable JSON to a plain fence', () => {
    const raw = '```json\nthis is not json at all\n```';
    const out = normalize(raw);
    expect(out.text).toMatch(/```\nthis is not json at all\n```/);
    expect(out.mutations).toContain('json-fence-unrepairable');
  });
});

describe('normalize — ui_block extraction', () => {
  it('extracts a well-formed ui_block JSON', () => {
    const raw = 'Headline\n```ui_block\n{"chart":"bar","value":42}\n```\nMore text';
    const out = normalize(raw);
    expect(out.uiBlock).toEqual({ chart: 'bar', value: 42 });
    expect(out.mutations).toContain('ui_block-extracted');
    expect(out.text).not.toMatch(/```ui_block/);
  });

  it('returns null uiBlock when no fence present', () => {
    const out = normalize('No block here.');
    expect(out.uiBlock).toBeNull();
  });

  it('wraps invalid ui_block JSON under { raw }', () => {
    const raw = 'before\n```ui_block\nnot-valid-json\n```\nafter';
    const out = normalize(raw);
    expect(out.uiBlock).toEqual({ raw: 'not-valid-json' });
  });

  it('removes the ui_block fence from the returned text', () => {
    const raw = 'Headline\n```ui_block\n{"x":1}\n```\nMore text';
    const out = normalize(raw);
    expect(out.text).not.toMatch(/```ui_block/);
    expect(out.text).toMatch(/Headline/);
    expect(out.text).toMatch(/More text/);
  });
});

describe('normalize — return shape', () => {
  it('always returns text, uiBlock, mutations', () => {
    const out = normalize('hello');
    expect(typeof out.text).toBe('string');
    expect(out.uiBlock).toBeNull();
    expect(Array.isArray(out.mutations)).toBe(true);
  });

  it('trims leading whitespace from final text', () => {
    const out = normalize('   hello there');
    expect(out.text.startsWith(' ')).toBe(false);
  });
});

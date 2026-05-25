/**
 * Normalizer — Wave-K LITFIN-parity additions.
 *
 * Exercises the new repairs:
 *   - trailing pleasantry strip
 *   - smart-quote → ASCII (inside JSON repair)
 *   - leading-prose JSON extraction
 *   - empty-input handling
 *   - XML-style <ui_block> tag extraction
 */

import { describe, it, expect } from 'vitest';
import { normalize } from '../normalizer.js';

describe('normalizer — trailing pleasantry strip', () => {
  it('strips "Hope this helps!"', () => {
    const out = normalize('Arrears total TZS 250,000. Hope this helps!');
    expect(out.text).toBe('Arrears total TZS 250,000.');
    expect(out.mutations).toContain('trailing-pleasantry-stripped');
  });

  it('strips "Let me know if you have any other questions."', () => {
    const out = normalize(
      'On-time rate is 95%. Let me know if you have any other questions.',
    );
    expect(out.text).toBe('On-time rate is 95%.');
    expect(out.mutations).toContain('trailing-pleasantry-stripped');
  });

  it('strips "Feel free to ask…"', () => {
    const out = normalize('Done. Feel free to ask anything else!');
    expect(out.text).toBe('Done.');
    expect(out.mutations).toContain('trailing-pleasantry-stripped');
  });

  it('leaves answers without pleasantries untouched', () => {
    const out = normalize('Total: TZS 1,200,000.');
    expect(out.text).toBe('Total: TZS 1,200,000.');
    expect(out.mutations).not.toContain('trailing-pleasantry-stripped');
  });
});

describe('normalizer — empty-input handling', () => {
  it('returns empty text + empty-input mutation for ""', () => {
    const out = normalize('');
    expect(out.text).toBe('');
    expect(out.mutations).toContain('empty-input');
  });
});

describe('normalizer — JSON smart-quote repair (inside fence)', () => {
  it('translates curly quotes to ASCII when repairing JSON', () => {
    // Note: smart quotes only triggered on the repair pass, not on the
    // happy path. So we craft a JSON that's broken (trailing comma)
    // AND uses smart quotes — both repairs fire.
    const raw = '```json\n{“a”: “1”,}\n```';
    const out = normalize(raw);
    expect(out.mutations).toContain('json-fence-repaired');
    expect(out.mutations).toContain('smart-quote-translated');
    expect(out.text).toContain('"a"');
  });
});

describe('normalizer — leading-prose JSON extraction', () => {
  it('rescues a JSON object wrapped in a sentence', () => {
    const raw = '```json\nHere is the data: {"a":1, "b":2}\n```';
    const out = normalize(raw);
    expect(out.mutations).toContain('json-fence-extracted-from-prose');
    expect(out.text).toMatch(/"a"/);
  });

  it('downgrades when no balanced JSON substring exists', () => {
    const raw = '```json\nthis is not json at all\n```';
    const out = normalize(raw);
    expect(out.mutations).toContain('json-fence-unrepairable');
  });
});

describe('normalizer — XML-style ui_block tag', () => {
  it('extracts an <ui_block> tag with valid JSON inside', () => {
    const raw =
      'Body text. <ui_block>{"type":"card","title":"hello"}</ui_block>';
    const out = normalize(raw);
    expect(out.uiBlock).toEqual({ type: 'card', title: 'hello' });
    expect(out.mutations).toContain('ui_block-extracted');
    expect(out.text).toBe('Body text.');
  });

  it('still prefers ```ui_block fence over <ui_block> tag', () => {
    const raw = '```ui_block\n{"a":1}\n```';
    const out = normalize(raw);
    expect(out.uiBlock).toEqual({ a: 1 });
    expect(out.mutations).toContain('ui_block-extracted');
  });
});

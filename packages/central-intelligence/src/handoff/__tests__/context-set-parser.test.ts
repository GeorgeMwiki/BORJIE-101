/**
 * parseContextSet (K-D) tests.
 *
 * Validates the `<context_set>` SSE tag extraction + stack zod
 * validation + idempotent body strip.
 */

import { describe, it, expect } from 'vitest';
import { parseContextSet } from '../context-set-parser.js';

describe('parseContextSet', () => {
  it('extracts a valid stack and strips the tag', () => {
    const text = `Looking at Mwadui now.<context_set>{"stack":[{"kind":"site","id":"mwadui","label":"Mwadui","scopeId":"mwadui"}]}</context_set> What next?`;
    const result = parseContextSet(text);
    expect(result.stack).toHaveLength(1);
    expect(result.stack?.[0]?.id).toBe('mwadui');
    expect(result.body).not.toContain('<context_set');
    expect(result.body).toContain('Looking at Mwadui now.');
    expect(result.body).toContain('What next?');
  });

  it('returns null stack when no tag is present', () => {
    const result = parseContextSet('plain reply with no context_set');
    expect(result.stack).toBeNull();
    expect(result.dropped).toBe(0);
    expect(result.body).toBe('plain reply with no context_set');
  });

  it('drops a context_set with an invalid crumb schema', () => {
    const text = `<context_set>{"stack":[{"kind":"site","id":"mwadui"}]}</context_set>`; // missing label
    const result = parseContextSet(text);
    expect(result.stack).toBeNull();
    expect(result.dropped).toBe(1);
    expect(result.body).not.toContain('<context_set');
  });

  it('keeps the FIRST context_set when multiple appear', () => {
    const text =
      `<context_set>{"stack":[{"kind":"site","id":"mwadui","label":"Mwadui"}]}</context_set>` +
      `<context_set>{"stack":[{"kind":"site","id":"buzwagi","label":"Buzwagi"}]}</context_set>`;
    const result = parseContextSet(text);
    expect(result.stack).toHaveLength(1);
    expect(result.stack?.[0]?.id).toBe('mwadui');
    expect(result.dropped).toBe(1);
  });

  it('caps stack at 8 (drops if too long)', () => {
    const big = {
      stack: Array.from({ length: 9 }, (_, i) => ({
        kind: 'tab',
        id: `t${i}`,
        label: `T${i}`,
      })),
    };
    const text = `<context_set>${JSON.stringify(big)}</context_set>`;
    const result = parseContextSet(text);
    expect(result.stack).toBeNull();
    expect(result.dropped).toBe(1);
  });

  it('returns frozen output', () => {
    const text = `<context_set>{"stack":[{"kind":"site","id":"mwadui","label":"Mwadui"}]}</context_set>`;
    const result = parseContextSet(text);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.stack)).toBe(true);
    expect(Object.isFrozen(result.stack?.[0])).toBe(true);
  });
});

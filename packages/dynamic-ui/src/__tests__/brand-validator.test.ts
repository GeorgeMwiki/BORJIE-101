import { describe, expect, it } from 'vitest';

import {
  validateBrandTokens,
  assertBrandTokens,
  BrandTokenViolationError,
} from '../brand-validator.js';

describe('validateBrandTokens — accepts brand-token references', () => {
  it('accepts an empty payload', () => {
    expect(validateBrandTokens({})).toEqual({ ok: true });
  });

  it('accepts a plain Tailwind utility className', () => {
    const result = validateBrandTokens({
      className: 'flex flex-col gap-4 p-4 text-foreground',
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a brand-tokenised className', () => {
    const result = validateBrandTokens({
      className: 'bg-signal-500 text-primary-foreground rounded-md shadow-md',
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a var(--…) reference in style', () => {
    const result = validateBrandTokens({
      style: { color: 'var(--signal-500)', backgroundColor: 'var(--surface)' },
    });
    expect(result.ok).toBe(true);
  });

  it('accepts hsl(var(--…)) in style', () => {
    const result = validateBrandTokens({
      style: { color: 'hsl(var(--signal-500))' },
    });
    expect(result.ok).toBe(true);
  });

  it('accepts oklch(var(--…)) in style', () => {
    const result = validateBrandTokens({
      style: { color: 'oklch(var(--signal-500))' },
    });
    expect(result.ok).toBe(true);
  });

  it('accepts the allowlisted special values', () => {
    const result = validateBrandTokens({
      style: {
        color: 'transparent',
        backgroundColor: 'currentColor',
        borderColor: 'inherit',
      },
    });
    expect(result.ok).toBe(true);
  });

  it('accepts numeric style values', () => {
    const result = validateBrandTokens({
      style: { zIndex: 10, lineHeight: 1.4, opacity: 0.8 },
    });
    expect(result.ok).toBe(true);
  });

  it('walks deeply nested objects', () => {
    const result = validateBrandTokens({
      kind: 'prefill-form',
      data: {
        fields: [
          { className: 'gap-4' },
          { className: 'p-2' },
        ],
      },
    });
    expect(result.ok).toBe(true);
  });
});

describe('validateBrandTokens — rejects raw colors', () => {
  it('rejects raw hex in className', () => {
    const result = validateBrandTokens({ className: 'bg-[#ff0000]' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('rejects raw hex in style', () => {
    const result = validateBrandTokens({
      style: { color: '#abcdef' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects rgb() literal in style', () => {
    const result = validateBrandTokens({
      style: { color: 'rgb(255, 0, 0)' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects raw hsl() literal', () => {
    const result = validateBrandTokens({
      style: { color: 'hsl(30, 72%, 52%)' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects raw oklch() literal', () => {
    const result = validateBrandTokens({
      style: { color: 'oklch(0.7 0.1 60)' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects named CSS colors in style', () => {
    const result = validateBrandTokens({
      style: { color: 'red' },
    });
    expect(result.ok).toBe(false);
  });
});

describe('validateBrandTokens — rejects Tailwind arbitrary values', () => {
  it('rejects gap-[…]', () => {
    const result = validateBrandTokens({ className: 'flex gap-[17px]' });
    expect(result.ok).toBe(false);
  });

  it('rejects p-[…]', () => {
    const result = validateBrandTokens({ className: 'p-[3rem]' });
    expect(result.ok).toBe(false);
  });

  it('rejects text-[#…]', () => {
    const result = validateBrandTokens({ className: 'text-[#ff0000]' });
    expect(result.ok).toBe(false);
  });

  it('rejects rounded-[…]', () => {
    const result = validateBrandTokens({ className: 'rounded-[8px]' });
    expect(result.ok).toBe(false);
  });

  it('rejects shadow-[…]', () => {
    const result = validateBrandTokens({
      className: 'shadow-[0_2px_4px_rgba(0,0,0,0.1)]',
    });
    expect(result.ok).toBe(false);
  });
});

describe('validateBrandTokens — rejects inline style misuse', () => {
  it('rejects raw color in nested children', () => {
    const result = validateBrandTokens({
      kind: 'prefill-form',
      props: {
        children: [
          { className: 'gap-2' },
          { style: { backgroundColor: '#fff' } },
        ],
      },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects inline style string with raw hex', () => {
    const result = validateBrandTokens({
      style: 'color: #ff0000; gap: 4px;',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects non-string non-number non-null style value', () => {
    const result = validateBrandTokens({
      style: { color: { weird: 'object' } },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects brand-gated property without a token reference', () => {
    const result = validateBrandTokens({
      style: { fontFamily: 'Comic Sans' },
    });
    expect(result.ok).toBe(false);
  });

  it('collects multiple violations across the payload', () => {
    const result = validateBrandTokens({
      className: 'gap-[17px]',
      style: { color: 'red', backgroundColor: '#ff0000' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('assertBrandTokens', () => {
  it('does nothing when valid', () => {
    expect(() => assertBrandTokens({ className: 'gap-4' })).not.toThrow();
  });

  it('throws BrandTokenViolationError on raw color', () => {
    let caught: unknown = null;
    try {
      assertBrandTokens({ style: { color: '#ff0000' } });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BrandTokenViolationError);
    if (caught instanceof BrandTokenViolationError) {
      expect(caught.violations.length).toBeGreaterThan(0);
    }
  });
});

describe('validateBrandTokens — edge cases', () => {
  it('accepts arrays of strings (not className-keyed)', () => {
    const result = validateBrandTokens(['a', 'b', 'c']);
    expect(result.ok).toBe(true);
  });

  it('accepts a null payload', () => {
    expect(validateBrandTokens(null).ok).toBe(true);
  });

  it('accepts a primitive payload (number, string)', () => {
    expect(validateBrandTokens(42).ok).toBe(true);
    expect(validateBrandTokens('hello').ok).toBe(true);
  });

  it('handles empty className string', () => {
    expect(validateBrandTokens({ className: '' }).ok).toBe(true);
  });

  it('handles class as className alternative', () => {
    const result = validateBrandTokens({ class: 'gap-[17px]' });
    expect(result.ok).toBe(false);
  });
});

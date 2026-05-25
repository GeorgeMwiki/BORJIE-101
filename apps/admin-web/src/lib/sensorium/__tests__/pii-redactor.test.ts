/**
 * pii-redactor — unit tests.
 */
import { describe, it, expect } from 'vitest';
import { hasPii, redactToShape, truncate } from '../pii-redactor';

describe('pii-redactor — hasPii()', () => {
  it('detects email addresses', () => {
    expect(hasPii('alice@example.com')).toBe(true);
  });

  it('detects international phone numbers', () => {
    expect(hasPii('+255 712 345 678')).toBe(true);
  });

  it('detects KRA PIN format (Kenya tax id)', () => {
    expect(hasPii('A123456789B')).toBe(true);
  });

  it('detects Tanzania NIDA national-id', () => {
    expect(hasPii('19880101-12345-67890-12')).toBe(true);
  });

  it('returns false for plain prose', () => {
    expect(hasPii('The rent for unit 4B is due')).toBe(false);
  });

  it('returns false for very short values', () => {
    expect(hasPii('hi')).toBe(false);
  });

  it('returns false for non-strings', () => {
    expect(hasPii(undefined)).toBe(false);
    expect(hasPii(42 as never)).toBe(false);
  });
});

describe('pii-redactor — redactToShape()', () => {
  it('never returns the raw value', () => {
    const out = redactToShape({
      fieldName: 'email',
      value: 'alice@example.com',
    });
    expect((out as unknown as Record<string, unknown>).value).toBeUndefined();
    expect(out.fieldName).toBe('email');
    expect(out.valueLength).toBe('alice@example.com'.length);
    expect(out.hasPii).toBe(true);
  });

  it('flags hasPii=true for password fields regardless of content', () => {
    const out = redactToShape({
      fieldName: 'secret',
      value: 'abc',
      type: 'password',
    });
    expect(out.hasPii).toBe(true);
  });

  it('flags hasPii=false for non-PII shape', () => {
    const out = redactToShape({
      fieldName: 'note',
      value: 'leak detected in unit',
    });
    expect(out.hasPii).toBe(false);
  });

  it('truncates fieldName to 80 chars', () => {
    const big = 'x'.repeat(200);
    const out = redactToShape({ fieldName: big, value: 'hi' });
    expect(out.fieldName.length).toBeLessThanOrEqual(80);
  });
});

describe('pii-redactor — truncate()', () => {
  it('returns the string when within limit', () => {
    expect(truncate('hello', 20)).toBe('hello');
  });

  it('truncates with an ellipsis when over limit', () => {
    const out = truncate('x'.repeat(50), 10);
    expect(out.length).toBe(10);
    expect(out.endsWith('…')).toBe(true);
  });

  it('returns empty for non-strings', () => {
    expect(truncate(undefined, 10)).toBe('');
  });
});

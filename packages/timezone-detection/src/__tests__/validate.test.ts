import { describe, expect, it } from 'vitest';
import { assertValidTimezone, isValidTimezone } from '../detect/validate.js';

describe('isValidTimezone', () => {
  it('accepts canonical IANA ids', () => {
    expect(isValidTimezone('Africa/Nairobi')).toBe(true);
    expect(isValidTimezone('Africa/Dar_es_Salaam')).toBe(true);
    expect(isValidTimezone('Europe/London')).toBe(true);
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
  });

  it('accepts legacy aliases that resolve canonically', () => {
    // US/Eastern is a legacy alias of America/New_York.
    expect(isValidTimezone('US/Eastern')).toBe(true);
  });

  it('rejects empty / non-string input', () => {
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone(null)).toBe(false);
    expect(isValidTimezone(undefined)).toBe(false);
    expect(isValidTimezone(42)).toBe(false);
    expect(isValidTimezone({})).toBe(false);
  });

  it('rejects clearly invalid zone strings', () => {
    expect(isValidTimezone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimezone('Africa/NotARealCity')).toBe(false);
    expect(isValidTimezone(' ')).toBe(false);
  });
});

describe('assertValidTimezone', () => {
  it('does not throw on valid id', () => {
    expect(() => assertValidTimezone('Africa/Nairobi')).not.toThrow();
  });

  it('throws on invalid id', () => {
    expect(() => assertValidTimezone('Mars/Olympus_Mons')).toThrowError(
      /Invalid IANA timezone/,
    );
  });
});

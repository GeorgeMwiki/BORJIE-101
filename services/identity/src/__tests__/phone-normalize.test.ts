/**
 * Unit tests for phone-normalize.
 */

import { describe, it, expect } from 'vitest';
import { normalizePhoneForCountry } from '../phone-normalize.js';

describe('normalizePhoneForCountry', () => {
  it('normalizes Tanzanian local format (0x...) to E.164 digits', () => {
    expect(normalizePhoneForCountry('0712345678', 'TZ')).toBe('255712345678');
  });

  it('normalizes Tanzanian international format (+255...) to E.164 digits', () => {
    expect(normalizePhoneForCountry('+255 712 345 678', 'TZ')).toBe(
      '255712345678'
    );
  });

  it('is idempotent: normalizing an already-normalized value returns the same', () => {
    const once = normalizePhoneForCountry('0712345678', 'TZ');
    const twice = normalizePhoneForCountry(once, 'TZ');
    expect(twice).toBe(once);
  });

  it('handles Kenyan numbers with trunk prefix', () => {
    expect(normalizePhoneForCountry('0712345678', 'KE')).toBe('254712345678');
  });

  it('throws on empty input', () => {
    expect(() => normalizePhoneForCountry('', 'TZ')).toThrow(/empty/);
  });

  it('throws on unknown country code', () => {
    expect(() => normalizePhoneForCountry('0712345678', 'ZZ')).toThrow(
      /unknown country code/
    );
  });

  it('strips non-digit decorations (parens, dashes, spaces)', () => {
    expect(normalizePhoneForCountry('(071) 234-5678', 'TZ')).toBe(
      '255712345678'
    );
  });
});

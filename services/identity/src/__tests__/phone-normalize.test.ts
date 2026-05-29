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

  // ─── Issue #207 — world-scale tenants (WS-4) ─────────────────────────────
  it('handles Nigerian numbers with trunk prefix (+234)', () => {
    expect(normalizePhoneForCountry('08012345678', 'NG')).toBe(
      '2348012345678',
    );
    expect(normalizePhoneForCountry('+234 801 234 5678', 'NG')).toBe(
      '2348012345678',
    );
  });

  it('handles South African numbers with trunk prefix (+27)', () => {
    expect(normalizePhoneForCountry('0712345678', 'ZA')).toBe('27712345678');
    expect(normalizePhoneForCountry('+27 71 234 5678', 'ZA')).toBe(
      '27712345678',
    );
  });

  it('handles Australian numbers with trunk prefix (+61)', () => {
    expect(normalizePhoneForCountry('0412345678', 'AU')).toBe('61412345678');
    expect(normalizePhoneForCountry('+61 412 345 678', 'AU')).toBe(
      '61412345678',
    );
  });

  it('handles Indonesian numbers with trunk prefix (+62)', () => {
    expect(normalizePhoneForCountry('081234567890', 'ID')).toBe(
      '6281234567890',
    );
    expect(normalizePhoneForCountry('+62 812 3456 7890', 'ID')).toBe(
      '6281234567890',
    );
  });

  it('handles Chilean numbers (no trunk prefix, +56 only)', () => {
    expect(normalizePhoneForCountry('+56 9 1234 5678', 'CL')).toBe(
      '56912345678',
    );
    // No leading zero in Chile — bare digits pass through with prefix
    expect(normalizePhoneForCountry('912345678', 'CL')).toBe('56912345678');
  });
});

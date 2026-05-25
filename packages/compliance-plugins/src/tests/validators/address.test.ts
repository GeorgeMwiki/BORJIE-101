import { describe, expect, it } from 'vitest';

import { validateAddress } from '../../validators/address.js';

describe('validateAddress', () => {
  it('extracts DE postal code + city', () => {
    const r = validateAddress('Alexanderstr. 1\n10178 Berlin', 'DE');
    expect(r.status).toBe('valid');
    expect(r.postalCode).toBe('10178');
    expect(r.city).toBe('Berlin');
  });

  it('accepts GB postcode with space', () => {
    const r = validateAddress('10 Downing Street\nLondon SW1A 2AA', 'GB');
    expect(r.status).toBe('valid');
    expect(r.postalCode).toBe('SW1A 2AA');
  });

  it('flags missing postal code when rule requires it', () => {
    const r = validateAddress('Some street\nBerlin', 'DE');
    expect(r.status).toBe('invalid');
    expect(r.missingFields).toContain('postalCode-format');
  });

  it('returns unverified for unknown country — does not reject', () => {
    const r = validateAddress('Street 1\nCity', 'XX');
    expect(r.status).toBe('unverified');
    expect(r.rawInput).toContain('Street 1');
  });

  it('rejects empty input', () => {
    expect(validateAddress('', 'DE').status).toBe('invalid');
  });
});

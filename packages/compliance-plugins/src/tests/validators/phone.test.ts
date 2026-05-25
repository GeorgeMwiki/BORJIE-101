import { describe, expect, it } from 'vitest';

import { validatePhone, buildPhoneValidatorForCountry } from '../../validators/phone.js';

describe('validatePhone', () => {
  it('accepts international +DE form', () => {
    const r = validatePhone('+49 30 12345678');
    expect(r.status).toBe('valid');
    expect(r.e164).toBe('+493012345678');
    expect(r.countryCode).toBe('DE');
  });

  it('accepts country-hinted local number (KR)', () => {
    const r = validatePhone('010-1234-5678', 'KR');
    expect(r.status).toBe('valid');
    expect(r.e164).toBe('+821012345678');
    expect(r.callingCode).toBe('82');
  });

  it('needs a country hint for bare local digits', () => {
    const r = validatePhone('12345678');
    expect(r.status).toBe('needs-country-hint');
  });

  it('rejects too-short input', () => {
    const r = validatePhone('+44 12');
    expect(r.status).toBe('invalid');
  });

  it('rejects too-long input (> 15 digits)', () => {
    const r = validatePhone('+1234567890123456789');
    expect(r.status).toBe('invalid');
  });

  it('rejects empty input', () => {
    expect(validatePhone('').status).toBe('invalid');
  });

  it('buildPhoneValidatorForCountry pre-binds country hint', () => {
    const deValidator = buildPhoneValidatorForCountry('DE');
    const r = deValidator('03012345678');
    expect(r.status).toBe('valid');
    expect(r.e164).toBe('+493012345678');
  });

  it('Round-3 H20 fix: returns validation-unavailable for unknown calling code', () => {
    // Pre-fix: returned `valid` with a never-deliverable E.164 string.
    // Callers downstream burned SMS/WhatsApp provider credits on 400s.
    // Post-fix: surfaces a typed status so callers retry with a hint.
    const r = validatePhone('+99912345678');
    expect(r.status).toBe('validation-unavailable');
    expect(r.e164).toBeUndefined();
  });
});

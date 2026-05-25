import { describe, expect, it } from 'vitest';

import { validateTaxId } from '../../validators/tax-id.js';

describe('validateTaxId', () => {
  it('validates DE USt-IdNr.', () => {
    expect(validateTaxId('DE123456789', 'DE').status).toBe('valid');
  });

  it('validates US EIN', () => {
    expect(validateTaxId('12-3456789', 'US').status).toBe('valid');
    expect(validateTaxId('123-45-6789', 'US').status).toBe('valid'); // SSN/ITIN
  });

  it('validates IN PAN + GSTIN', () => {
    expect(validateTaxId('ABCDE1234F', 'IN').status).toBe('valid');
    expect(validateTaxId('22AAAAA0000A1Z5', 'IN').status).toBe('valid');
  });

  it('validates GB VAT', () => {
    expect(validateTaxId('GB123456789', 'GB').status).toBe('valid');
  });

  it('returns invalid for wrong format', () => {
    expect(validateTaxId('not-a-real-id', 'DE').status).toBe('invalid');
  });

  it('returns validation-unavailable for unknown country', () => {
    const r = validateTaxId('whatever', 'ZZ');
    expect(r.status).toBe('validation-unavailable');
  });

  it('rejects empty input', () => {
    expect(validateTaxId('', 'US').status).toBe('invalid');
  });
});

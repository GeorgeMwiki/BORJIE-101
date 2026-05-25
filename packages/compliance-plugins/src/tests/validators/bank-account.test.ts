import { describe, expect, it } from 'vitest';

import {
  abaValid,
  bicValid,
  ibanValid,
  validateBankAccount,
} from '../../validators/bank-account.js';

describe('IBAN checksum', () => {
  it('accepts a known-good IBAN', () => {
    expect(ibanValid('DE89 3704 0044 0532 0130 00')).toBe(true);
    expect(ibanValid('GB82WEST12345698765432')).toBe(true);
  });

  it('rejects tampered IBAN', () => {
    expect(ibanValid('DE89 3704 0044 0532 0130 99')).toBe(false);
  });
});

describe('ABA check', () => {
  it('validates a known ABA routing', () => {
    // 011000015 — Fed Boston routing (public)
    expect(abaValid('011000015')).toBe(true);
  });

  it('rejects 8-digit input', () => {
    expect(abaValid('12345678')).toBe(false);
  });
});

describe('BIC format', () => {
  it('accepts a valid 8-char BIC', () => {
    expect(bicValid('DEUTDEFF')).toBe(true);
  });

  it('accepts a valid 11-char BIC with branch code', () => {
    expect(bicValid('DEUTDEFF500')).toBe(true);
  });

  it('rejects malformed BIC', () => {
    expect(bicValid('INVALID')).toBe(false);
  });
});

describe('validateBankAccount dispatcher', () => {
  it('recognises IBAN input', () => {
    const r = validateBankAccount('DE89 3704 0044 0532 0130 00');
    expect(r.status).toBe('valid');
    expect(r.ruleId).toBe('iban');
  });

  it('recognises ABA input', () => {
    const r = validateBankAccount('011000015');
    expect(r.status).toBe('valid');
    expect(r.ruleId).toBe('aba');
  });

  it('returns validation-unavailable for unknown format', () => {
    const r = validateBankAccount('1234-567-8');
    expect(r.status).toBe('validation-unavailable');
  });

  it('rejects empty input', () => {
    expect(validateBankAccount('').status).toBe('invalid');
  });
});

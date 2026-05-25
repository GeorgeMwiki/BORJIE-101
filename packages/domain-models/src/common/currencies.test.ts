/**
 * ISO-4217 currency table tests.
 *
 * Pins Wave 27 / Blueprint §A.1 / A3-A4: MoneySchema no longer freezes
 * at 7 codes; CURRENCY_DECIMALS now covers the full ISO-4217 subset
 * needed by every compliance plugin we ship.
 */

import { describe, it, expect } from 'vitest';
import {
  ISO_4217_DECIMALS,
  SUPPORTED_CURRENCY_CODES,
  decimalsForCurrency,
  isKnownCurrency,
} from './currencies.js';
import { MoneySchema, money, moneyFromDecimal, toDecimal, formatMoney } from './money.js';

describe('ISO-4217 currency table', () => {
  it('covers the East African trio with 0 decimals', () => {
    expect(ISO_4217_DECIMALS.TZS).toBe(0);
    expect(ISO_4217_DECIMALS.UGX).toBe(0);
    expect(ISO_4217_DECIMALS.RWF).toBe(0);
  });

  it('covers JPY, KRW, VND as 0-decimal', () => {
    expect(ISO_4217_DECIMALS.JPY).toBe(0);
    expect(ISO_4217_DECIMALS.KRW).toBe(0);
    expect(ISO_4217_DECIMALS.VND).toBe(0);
  });

  it('covers the 3-decimal gulf currencies', () => {
    expect(ISO_4217_DECIMALS.BHD).toBe(3);
    expect(ISO_4217_DECIMALS.KWD).toBe(3);
    expect(ISO_4217_DECIMALS.JOD).toBe(3);
    expect(ISO_4217_DECIMALS.OMR).toBe(3);
    expect(ISO_4217_DECIMALS.TND).toBe(3);
  });

  it('covers the common 2-decimal majors', () => {
    for (const code of ['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'CNY', 'INR', 'BRL', 'MXN']) {
      expect(ISO_4217_DECIMALS[code]).toBe(2);
    }
  });

  it('exposes a list of every supported currency', () => {
    expect(SUPPORTED_CURRENCY_CODES.length).toBeGreaterThan(140);
    expect(SUPPORTED_CURRENCY_CODES).toContain('KES');
    expect(SUPPORTED_CURRENCY_CODES).toContain('JPY');
  });

  it('decimalsForCurrency defaults to 2 for unknown codes', () => {
    expect(decimalsForCurrency('XYZ')).toBe(2);
  });

  it('isKnownCurrency is strict', () => {
    expect(isKnownCurrency('USD')).toBe(true);
    expect(isKnownCurrency('XYZ')).toBe(false);
  });
});

describe('MoneySchema validates ISO-4217 shape, not a 7-code enum', () => {
  it('accepts JPY (previously rejected)', () => {
    const parsed = MoneySchema.parse({ amount: 1000, currency: 'JPY' });
    expect(parsed.currency).toBe('JPY');
  });

  it('accepts KRW (previously rejected)', () => {
    const parsed = MoneySchema.parse({ amount: 50000, currency: 'KRW' });
    expect(parsed.currency).toBe('KRW');
  });

  it('accepts AED (previously rejected)', () => {
    const parsed = MoneySchema.parse({ amount: 2500, currency: 'AED' });
    expect(parsed.currency).toBe('AED');
  });

  it('rejects a non-3-letter code', () => {
    expect(() => MoneySchema.parse({ amount: 1, currency: 'US' })).toThrow();
    expect(() => MoneySchema.parse({ amount: 1, currency: 'us' })).toThrow();
  });
});

describe('Money respects currency precision for new currencies', () => {
  it('JPY behaves as 0-decimal', () => {
    const m = money(10000, 'JPY');
    expect(toDecimal(m)).toBe(10000);
    expect(moneyFromDecimal(10000, 'JPY').amount).toBe(10000);
  });

  it('KRW behaves as 0-decimal', () => {
    const m = money(50000, 'KRW');
    expect(toDecimal(m)).toBe(50000);
  });

  it('BHD behaves as 3-decimal', () => {
    const m = moneyFromDecimal(12.345, 'BHD');
    expect(m.amount).toBe(12345);
    expect(toDecimal(m)).toBe(12.345);
  });

  it('formatMoney renders JPY without decimals', () => {
    const formatted = formatMoney(money(10000, 'JPY'), 'ja-JP');
    expect(formatted).not.toContain('.');
  });
});

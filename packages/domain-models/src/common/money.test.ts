/**
 * Money currency-precision tests.
 *
 * Pins Wave-19 fix: TZS / UGX / RWF are 0-decimal currencies. The
 * previous `/100` hardcode silently divided these by 100, so TSh 50,000
 * was displayed as TSh 500 on every invoice, statement, and QR code.
 *
 * These tests fail under the pre-Wave-19 implementation and pass now.
 */

import { describe, it, expect } from 'vitest';
import {
  Money,
  money,
  moneyFromDecimal,
  toDecimal,
  formatMoney,
  CURRENCY_DECIMALS,
} from './money.js';

describe('Money — currency precision (Wave 19 fix)', () => {
  it('TZS is 0-decimal: minor unit equals main unit', () => {
    const m = money(50000, 'TZS');
    expect(toDecimal(m)).toBe(50000);
  });

  it('UGX is 0-decimal: minor unit equals main unit', () => {
    const m = money(12345, 'UGX');
    expect(toDecimal(m)).toBe(12345);
  });

  it('RWF is 0-decimal: minor unit equals main unit', () => {
    const m = money(7500, 'RWF');
    expect(toDecimal(m)).toBe(7500);
  });

  it('KES is 2-decimal: divides by 100', () => {
    const m = money(12345, 'KES');
    expect(toDecimal(m)).toBe(123.45);
  });

  it('USD is 2-decimal: divides by 100', () => {
    const m = money(999, 'USD');
    expect(toDecimal(m)).toBe(9.99);
  });

  it('moneyFromDecimal respects currency precision for TZS (no multiply)', () => {
    const m = moneyFromDecimal(50000, 'TZS');
    expect(m.amount).toBe(50000);
    expect(toDecimal(m)).toBe(50000);
  });

  it('moneyFromDecimal respects currency precision for KES (multiply by 100)', () => {
    const m = moneyFromDecimal(123.45, 'KES');
    expect(m.amount).toBe(12345);
    expect(toDecimal(m)).toBe(123.45);
  });

  it('formatMoney renders TZS without decimal places', () => {
    const m = money(50000, 'TZS');
    const formatted = formatMoney(m, 'en-TZ');
    expect(formatted).not.toContain('.');
    expect(formatted).toMatch(/50,?000/);
  });

  it('formatMoney renders KES with 2 decimals', () => {
    const m = money(12345, 'KES');
    const formatted = formatMoney(m);
    expect(formatted).toMatch(/123\.45/);
  });

  it('CURRENCY_DECIMALS table matches ISO 4217 published precision', () => {
    expect(CURRENCY_DECIMALS.KES).toBe(2);
    expect(CURRENCY_DECIMALS.TZS).toBe(0);
    expect(CURRENCY_DECIMALS.UGX).toBe(0);
    expect(CURRENCY_DECIMALS.RWF).toBe(0);
    expect(CURRENCY_DECIMALS.USD).toBe(2);
    expect(CURRENCY_DECIMALS.EUR).toBe(2);
    expect(CURRENCY_DECIMALS.GBP).toBe(2);
  });

  it('round-trip: moneyFromDecimal → toDecimal is identity per currency', () => {
    for (const c of ['KES', 'USD', 'TZS', 'UGX', 'RWF'] as const) {
      const input = 12345;
      const m = moneyFromDecimal(input, c);
      expect(toDecimal(m)).toBe(input);
    }
  });

  it('Money constructor rejects non-integer amounts regardless of currency', () => {
    expect(() => new Money(123.45, 'KES')).toThrow();
    expect(() => new Money(50000.5, 'TZS')).toThrow();
  });
});

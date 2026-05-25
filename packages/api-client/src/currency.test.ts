/**
 * Tests for the shared ISO-4217-aware currency formatter.
 *
 * These tests pin the contract that downstream frontends rely on:
 *   - 2-decimal currencies (KES, USD, EUR) render with `.00`
 *   - 0-decimal currencies (JPY, KRW, UGX, RWF) render without any decimals
 *   - 3-decimal currencies (BHD, KWD, JOD, OMR, TND) render with `.000`
 *   - 4-decimal currencies (CLF) render with `.0000`
 *   - Missing/empty `currency` arg throws (no silent USD fallback)
 *   - Unknown codes fall back to 2 decimals (matches domain-models)
 *
 * `Intl.NumberFormat` output differs by ICU build, so we assert on
 * regex shape rather than exact glyphs — the ISO code is always
 * present (we pin `currencyDisplay: 'code'`) and the decimal count
 * is deterministic.
 */

import { describe, it, expect } from 'vitest';
import { formatCurrency, getCurrencyDecimals } from './currency';

describe('getCurrencyDecimals', () => {
  it('returns 2 for KES, USD, EUR, GBP', () => {
    expect(getCurrencyDecimals('KES')).toBe(2);
    expect(getCurrencyDecimals('USD')).toBe(2);
    expect(getCurrencyDecimals('EUR')).toBe(2);
    expect(getCurrencyDecimals('GBP')).toBe(2);
  });

  it('returns 0 for JPY, KRW, UGX, RWF, TZS, VND', () => {
    expect(getCurrencyDecimals('JPY')).toBe(0);
    expect(getCurrencyDecimals('KRW')).toBe(0);
    expect(getCurrencyDecimals('UGX')).toBe(0);
    expect(getCurrencyDecimals('RWF')).toBe(0);
    expect(getCurrencyDecimals('TZS')).toBe(0);
    expect(getCurrencyDecimals('VND')).toBe(0);
  });

  it('returns 3 for BHD, KWD, JOD, OMR, TND, IQD, LYD', () => {
    expect(getCurrencyDecimals('BHD')).toBe(3);
    expect(getCurrencyDecimals('KWD')).toBe(3);
    expect(getCurrencyDecimals('JOD')).toBe(3);
    expect(getCurrencyDecimals('OMR')).toBe(3);
    expect(getCurrencyDecimals('TND')).toBe(3);
    expect(getCurrencyDecimals('IQD')).toBe(3);
    expect(getCurrencyDecimals('LYD')).toBe(3);
  });

  it('returns 4 for CLF', () => {
    expect(getCurrencyDecimals('CLF')).toBe(4);
  });

  it('defaults to 2 for unknown codes', () => {
    expect(getCurrencyDecimals('XYZ')).toBe(2);
    expect(getCurrencyDecimals('ZZZ')).toBe(2);
  });
});

describe('formatCurrency', () => {
  describe('2-decimal currencies', () => {
    it('formats KES with two decimals', () => {
      const result = formatCurrency(100000, 'KES', { locale: 'en-US' });
      expect(result).toContain('KES');
      expect(result).toMatch(/100[,.]000\.00/);
    });

    it('formats USD with two decimals', () => {
      const result = formatCurrency(1234.5, 'USD', { locale: 'en-US' });
      expect(result).toContain('USD');
      expect(result).toMatch(/1[,.]234\.50/);
    });
  });

  describe('0-decimal currencies', () => {
    it('formats JPY without decimals', () => {
      const result = formatCurrency(100000, 'JPY', { locale: 'en-US' });
      expect(result).toContain('JPY');
      expect(result).toMatch(/100[,.]000(?!\.)/);
      expect(result).not.toMatch(/\.\d/);
    });

    it('formats UGX without decimals', () => {
      const result = formatCurrency(50000, 'UGX', { locale: 'en-US' });
      expect(result).toContain('UGX');
      expect(result).not.toMatch(/\.\d/);
    });

    it('formats TZS without decimals', () => {
      const result = formatCurrency(50000, 'TZS', { locale: 'en-US' });
      expect(result).toContain('TZS');
      expect(result).not.toMatch(/\.\d/);
    });
  });

  describe('3-decimal currencies', () => {
    it('formats BHD with three decimals', () => {
      const result = formatCurrency(100, 'BHD', { locale: 'en-US' });
      expect(result).toContain('BHD');
      expect(result).toMatch(/100\.000/);
    });

    it('formats KWD with three decimals', () => {
      const result = formatCurrency(50.5, 'KWD', { locale: 'en-US' });
      expect(result).toContain('KWD');
      expect(result).toMatch(/50\.500/);
    });
  });

  describe('4-decimal currencies', () => {
    it('formats CLF with four decimals', () => {
      const result = formatCurrency(1, 'CLF', { locale: 'en-US' });
      expect(result).toContain('CLF');
      expect(result).toMatch(/1\.0000/);
    });
  });

  describe('case-insensitive currency codes', () => {
    it('upper-cases lowercase input before lookup', () => {
      const result = formatCurrency(100, 'jpy', { locale: 'en-US' });
      expect(result).toContain('JPY');
      expect(result).not.toMatch(/\.\d/);
    });
  });

  describe('non-finite amounts', () => {
    it('renders a safe placeholder for NaN', () => {
      const result = formatCurrency(Number.NaN, 'KES');
      expect(result).toBe('KES —');
    });

    it('renders a safe placeholder for Infinity', () => {
      const result = formatCurrency(Number.POSITIVE_INFINITY, 'USD');
      expect(result).toBe('USD —');
    });
  });

  describe('required currency arg', () => {
    it('throws when currency is missing (empty string)', () => {
      expect(() => formatCurrency(100, '')).toThrow(/required/i);
    });

    it('throws when currency is whitespace only', () => {
      expect(() => formatCurrency(100, '   ')).toThrow(/required/i);
    });

    it('throws when currency is undefined', () => {
      expect(() => formatCurrency(100, undefined)).toThrow(/required/i);
    });

    it('throws when currency is null', () => {
      expect(() => formatCurrency(100, null)).toThrow(/required/i);
    });
  });

  describe('unknown ISO codes', () => {
    it('falls back to 2 decimals for unknown codes that Intl still accepts', () => {
      // Intl may or may not accept 'XYZ'; test just verifies behaviour
      // either succeeds with 2 decimals or hits the manual fallback.
      const result = formatCurrency(100, 'XYZ', { locale: 'en-US' });
      expect(result).toContain('XYZ');
      expect(result).toMatch(/100\.00/);
    });
  });
});

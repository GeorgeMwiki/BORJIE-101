import { describe, it, expect } from 'vitest';
import {
  getRegionConfig,
  getSupportedCountries,
  isCountrySupported,
  normalizePhoneForCountry,
  getDefaultCurrency,
  buildTaxpayerIdSchema,
} from './region-config.js';

describe('getRegionConfig', () => {
  it('returns Tanzania config for TZ', () => {
    const cfg = getRegionConfig('TZ');
    expect(cfg.countryCode).toBe('TZ');
    expect(cfg.currencyCode).toBe('TZS');
    expect(cfg.defaultTimezone).toBe('Africa/Dar_es_Salaam');
    expect(cfg.phone.dialingCode).toBe('255');
    expect(cfg.compliance.taxAuthority).toBe('TRA');
    expect(cfg.mobileMoneyProviders.length).toBeGreaterThan(0);
  });

  it('returns Kenya config for KE', () => {
    const cfg = getRegionConfig('KE');
    expect(cfg.currencyCode).toBe('KES');
    expect(cfg.tax.rentalIncomeTaxRate).toBe(0.075);
  });

  it('returns Uganda config for UG', () => {
    const cfg = getRegionConfig('UG');
    expect(cfg.currencyCode).toBe('UGX');
    expect(cfg.currencyMinorUnits).toBe(0);
  });

  it('returns Rwanda config for RW', () => {
    const cfg = getRegionConfig('RW');
    expect(cfg.currencyCode).toBe('RWF');
  });

  it('is case-insensitive', () => {
    expect(getRegionConfig('tz').currencyCode).toBe('TZS');
    expect(getRegionConfig('Ke').currencyCode).toBe('KES');
  });

  it('returns generic USD fallback for unknown country', () => {
    const cfg = getRegionConfig('XX');
    expect(cfg.currencyCode).toBe('USD');
    expect(cfg.countryCode).toBe('XX');
  });

  it('returns generic fallback for null/undefined', () => {
    expect(getRegionConfig(null).currencyCode).toBe('USD');
    expect(getRegionConfig(undefined).currencyCode).toBe('USD');
  });
});

describe('getSupportedCountries', () => {
  it('retains the founder African set and adds plugin-registered countries', () => {
    const countries = getSupportedCountries();
    const codes = countries.map((c) => c.countryCode).sort();
    for (const expected of ['KE', 'RW', 'TZ', 'UG']) {
      expect(codes).toContain(expected);
    }
    // Plugin-registered countries (US/NG/ZA) must also be supported now
    // that region-config delegates to @borjie/compliance-plugins.
    expect(codes).toContain('US');
    expect(codes.length).toBeGreaterThanOrEqual(4);
  });
});

describe('isCountrySupported', () => {
  it('returns true for configured countries', () => {
    expect(isCountrySupported('TZ')).toBe(true);
    expect(isCountrySupported('KE')).toBe(true);
  });
  it('returns true for plugin-registered countries (US, NG, ZA)', () => {
    expect(isCountrySupported('US')).toBe(true);
  });
  it('returns false for unknown countries', () => {
    expect(isCountrySupported('XX')).toBe(false);
  });
});

describe('normalizePhoneForCountry', () => {
  it('normalizes TZ phone from local format', () => {
    expect(normalizePhoneForCountry('0712345678', 'TZ')).toBe('255712345678');
  });
  it('normalizes KE phone from local format', () => {
    expect(normalizePhoneForCountry('0712345678', 'KE')).toBe('254712345678');
  });
  it('strips non-digits', () => {
    expect(normalizePhoneForCountry('+255 712 345 678', 'TZ')).toBe('255712345678');
  });
  it('preserves already-prefixed numbers', () => {
    expect(normalizePhoneForCountry('255712345678', 'TZ')).toBe('255712345678');
  });
});

describe('getDefaultCurrency', () => {
  it('returns TZS for Tanzania', () => {
    expect(getDefaultCurrency('TZ')).toBe('TZS');
  });
  it('returns USD for unknown', () => {
    expect(getDefaultCurrency('XX')).toBe('USD');
  });
});

describe('delegation to @borjie/compliance-plugins', () => {
  it('picks up plugin-only countries (US) without a legacy overlay', () => {
    const cfg = getRegionConfig('US');
    expect(cfg.countryCode).toBe('US');
    expect(cfg.currencyCode).toBe('USD');
    expect(cfg.phone.dialingCode).toBe('1');
  });
  it('retains TZ overlay specifics (timezone, tax authority)', () => {
    const cfg = getRegionConfig('TZ');
    expect(cfg.defaultTimezone).toBe('Africa/Dar_es_Salaam');
    expect(cfg.compliance.taxAuthority).toBe('TRA');
    expect(cfg.mobileMoneyProviders.map((p) => p.id)).toContain('mpesa_tz');
  });
});

describe('buildTaxpayerIdSchema', () => {
  it('validates TZ TIN (9 digits)', () => {
    const schema = buildTaxpayerIdSchema('TZ');
    expect(schema.safeParse('123456789').success).toBe(true);
    expect(schema.safeParse('12345').success).toBe(false);
  });
  it('validates KE KRA PIN (A000000000B)', () => {
    const schema = buildTaxpayerIdSchema('KE');
    expect(schema.safeParse('A123456789B').success).toBe(true);
    expect(schema.safeParse('12345').success).toBe(false);
  });
  it('accepts any string for unknown country', () => {
    const schema = buildTaxpayerIdSchema('XX');
    expect(schema.safeParse('anything-goes').success).toBe(true);
  });
});

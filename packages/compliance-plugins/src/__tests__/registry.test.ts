import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CountryPluginRegistry,
  DEFAULT_COUNTRY_ID,
  UnknownJurisdictionError,
  __resetDefaultFallbackWarning,
  availableCountries,
  countryPluginRegistry,
  getCountryPlugin,
  kenyaPlugin,
  nigeriaPlugin,
  southAfricaPlugin,
  tanzaniaPlugin,
  ugandaPlugin,
  unitedStatesPlugin,
  withStateOverride,
} from '../index.js';

describe('CountryPluginRegistry', () => {
  it('resolves a registered plugin case-insensitively', () => {
    expect(getCountryPlugin('tz')?.countryCode).toBe('TZ');
    expect(getCountryPlugin('Tz')?.countryCode).toBe('TZ');
    expect(getCountryPlugin('TZ')?.countryCode).toBe('TZ');
  });

  it('exposes every bundled country via availableCountries()', () => {
    const codes = availableCountries();
    expect(codes).toEqual(expect.arrayContaining(['TZ', 'KE', 'UG', 'NG', 'ZA', 'US']));
    expect(codes.length).toBeGreaterThanOrEqual(6);
  });

  it('Round-3 C6 fix: throws UnknownJurisdictionError for unknown codes (no silent TZ fallback)', () => {
    // Round-3 audit C6 — the previous fallback-to-Tanzania behaviour
    // turned every typo into a compliance violation. The new contract
    // is fail-closed: callers that genuinely want a default must use
    // `resolvePlugin(...)` from `./registry.js`.
    expect(() => getCountryPlugin('XX')).toThrow(UnknownJurisdictionError);
    expect(() => getCountryPlugin('ZZ')).toThrow(UnknownJurisdictionError);
  });

  it('Round-3 C6 fix: throws UnknownJurisdictionError for null / undefined input', () => {
    expect(() => getCountryPlugin(null)).toThrow(UnknownJurisdictionError);
    expect(() => getCountryPlugin(undefined)).toThrow(UnknownJurisdictionError);
    expect(() => getCountryPlugin('')).toThrow(UnknownJurisdictionError);
  });

  it('DEFAULT_COUNTRY_ID is still exported for callers that explicitly opt into the legacy default', () => {
    // The constant remains exported for the few sites that genuinely
    // want the historical TZ default; they now must opt in by
    // passing it explicitly to `getCountryPlugin(DEFAULT_COUNTRY_ID)`.
    expect(DEFAULT_COUNTRY_ID).toBe('TZ');
    expect(getCountryPlugin(DEFAULT_COUNTRY_ID).countryCode).toBe('TZ');
  });

  it('rejects a plugin with an invalid country code', () => {
    const reg = new CountryPluginRegistry();
    expect(() =>
      reg.register({ ...tanzaniaPlugin, countryCode: 'TZA' })
    ).toThrow(/invalid country code/);
  });

  it('has() is case-insensitive and handles empty input', () => {
    expect(countryPluginRegistry.has('ke')).toBe(true);
    expect(countryPluginRegistry.has('KE')).toBe(true);
    expect(countryPluginRegistry.has('')).toBe(false);
  });
});

describe('phone normalization round-trip', () => {
  it('normalizes a Tanzanian local number to +255', () => {
    expect(tanzaniaPlugin.normalizePhone('0712345678')).toBe('+255712345678');
    expect(tanzaniaPlugin.normalizePhone('+255 712 345 678')).toBe('+255712345678');
    expect(tanzaniaPlugin.normalizePhone('255712345678')).toBe('+255712345678');
  });

  it('normalizes a Kenyan local number to +254', () => {
    expect(kenyaPlugin.normalizePhone('0712345678')).toBe('+254712345678');
    expect(kenyaPlugin.normalizePhone('+254-712-345-678')).toBe('+254712345678');
  });

  it('normalizes a Ugandan local number to +256', () => {
    expect(ugandaPlugin.normalizePhone('0712345678')).toBe('+256712345678');
  });

  it('normalizes a Nigerian local number to +234', () => {
    expect(nigeriaPlugin.normalizePhone('08012345678')).toBe('+2348012345678');
  });

  it('normalizes a South African local number to +27', () => {
    expect(southAfricaPlugin.normalizePhone('0821234567')).toBe('+27821234567');
  });

  it('normalizes a US bare 10-digit number to +1', () => {
    expect(unitedStatesPlugin.normalizePhone('2025551234')).toBe('+12025551234');
    expect(unitedStatesPlugin.normalizePhone('+1 (202) 555-1234')).toBe('+12025551234');
  });

  it('throws when given an empty phone input', () => {
    expect(() => tanzaniaPlugin.normalizePhone('')).toThrow(/empty/);
    expect(() => kenyaPlugin.normalizePhone('   ')).toThrow(/empty/);
  });
});

describe('currency lookup per country', () => {
  it.each([
    ['TZ', 'TZS'],
    ['KE', 'KES'],
    ['UG', 'UGX'],
    ['NG', 'NGN'],
    ['ZA', 'ZAR'],
    ['US', 'USD'],
  ])('country %s uses currency %s', (code, currency) => {
    expect(getCountryPlugin(code).currencyCode).toBe(currency);
  });
});

describe('compliance rule inheritance', () => {
  it('exposes numeric compliance defaults on every plugin', () => {
    for (const code of ['TZ', 'KE', 'UG', 'NG', 'ZA', 'US']) {
      const plugin = getCountryPlugin(code);
      expect(plugin.compliance.minDepositMonths).toBeGreaterThanOrEqual(0);
      expect(plugin.compliance.maxDepositMonths).toBeGreaterThanOrEqual(
        plugin.compliance.minDepositMonths
      );
      expect(plugin.compliance.noticePeriodDays).toBeGreaterThan(0);
    }
  });

  it('US withStateOverride composes a new plugin without mutating the base', () => {
    const california = withStateOverride('CA', {
      maxDepositMonths: 3,
      lateFeeCapRate: 0.06,
    });
    expect(california.compliance.maxDepositMonths).toBe(3);
    expect(california.compliance.lateFeeCapRate).toBeCloseTo(0.06);
    // Base plugin remains untouched — no mutation.
    expect(unitedStatesPlugin.compliance.maxDepositMonths).toBe(2);
    expect(unitedStatesPlugin.compliance.lateFeeCapRate).toBeCloseTo(0.05);
    expect(california.countryName).toBe('United States (CA)');
  });

  it('rejects a state override with a non-2-letter code', () => {
    expect(() => withStateOverride('CAL', {})).toThrow(/2 letters/);
  });
});

describe('Tanzania plugin surface', () => {
  it('exposes GePG as a government-portal payment gateway', () => {
    const gepg = tanzaniaPlugin.paymentGateways.find((g) => g.id === 'gepg');
    expect(gepg).toBeDefined();
    expect(gepg?.kind).toBe('government-portal');
  });

  it('exposes every Tanzanian mobile-money provider', () => {
    const ids = tanzaniaPlugin.paymentGateways
      .filter((g) => g.kind === 'mobile-money')
      .map((g) => g.id);
    expect(ids).toEqual(
      expect.arrayContaining(['mpesa_tz', 'tigopesa', 'airtelmoney_tz', 'halopesa'])
    );
  });

  it('exposes NIDA, CRB, BRELA, and TRA as KYC providers', () => {
    const ids = tanzaniaPlugin.kycProviders.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['nida', 'crb-tz', 'brela', 'tra']));
  });
});

describe('plugin immutability', () => {
  let registry: CountryPluginRegistry;
  beforeEach(() => {
    registry = new CountryPluginRegistry();
    registry.register(tanzaniaPlugin);
  });

  it('freezes the plugin object so assignment throws in strict mode', () => {
    const plugin = registry.resolve('TZ')!;
    expect(Object.isFrozen(plugin)).toBe(true);
    expect(() => {
      (plugin as { countryCode: string }).countryCode = 'XX';
    }).toThrow(TypeError);
  });

  it('deep-freezes nested compliance object', () => {
    const plugin = registry.resolve('TZ')!;
    expect(Object.isFrozen(plugin.compliance)).toBe(true);
    expect(() => {
      (plugin.compliance as { noticePeriodDays: number }).noticePeriodDays = 1;
    }).toThrow(TypeError);
  });

  it('deep-freezes nested kycProviders array and its elements', () => {
    const plugin = registry.resolve('TZ')!;
    expect(Object.isFrozen(plugin.kycProviders)).toBe(true);
    expect(Object.isFrozen(plugin.kycProviders[0])).toBe(true);
  });

  it('list() returns a frozen snapshot safe to iterate', () => {
    const codes = registry.list();
    expect(Object.isFrozen(codes)).toBe(true);
    expect(codes).toContain('TZ');
  });
});

/**
 * Domestic-contract currency guard tests (CLAUDE.md hard rule).
 *
 * Cases (per the lane brief):
 *   - TZ tenant + domestic non-TZS  -> REJECTED
 *   - TZ tenant + TZS               -> ALLOWED
 *   - KE tenant + KES               -> ALLOWED
 * plus jurisdiction-relative + fail-closed coverage.
 */

import { describe, it, expect } from 'vitest';

import {
  evaluateDomesticContractCurrency,
  domesticCurrencyRejectionMessage,
} from '../domestic-currency-guard';

describe('evaluateDomesticContractCurrency', () => {
  it('rejects a TZ tenant + domestic non-TZS contract (USD)', () => {
    const d = evaluateDomesticContractCurrency({
      countryCode: 'TZ',
      suppliedCurrency: 'USD',
    });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.code).toBe('DOMESTIC_NON_JURISDICTION_CURRENCY');
      expect(d.domesticCurrency).toBe('TZS');
      expect(d.suppliedCurrency).toBe('USD');
    }
  });

  it('rejects a TZ tenant + KES (another jurisdiction currency)', () => {
    const d = evaluateDomesticContractCurrency({
      countryCode: 'TZ',
      suppliedCurrency: 'KES',
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe('DOMESTIC_NON_JURISDICTION_CURRENCY');
  });

  it('allows a TZ tenant + TZS', () => {
    const d = evaluateDomesticContractCurrency({
      countryCode: 'TZ',
      suppliedCurrency: 'TZS',
    });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.domesticCurrency).toBe('TZS');
  });

  it('allows a TZ tenant when no currency supplied (defaults to domestic)', () => {
    const d = evaluateDomesticContractCurrency({
      countryCode: 'TZ',
      suppliedCurrency: null,
    });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.domesticCurrency).toBe('TZS');
  });

  it('allows a KE tenant + KES (honours its own primary currency)', () => {
    const d = evaluateDomesticContractCurrency({
      countryCode: 'KE',
      suppliedCurrency: 'KES',
    });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.domesticCurrency).toBe('KES');
  });

  it('rejects a KE tenant + TZS (non-jurisdiction currency)', () => {
    const d = evaluateDomesticContractCurrency({
      countryCode: 'KE',
      suppliedCurrency: 'TZS',
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.domesticCurrency).toBe('KES');
  });

  it('allows UG + UGX and NG + NGN (jurisdiction-relative)', () => {
    expect(
      evaluateDomesticContractCurrency({
        countryCode: 'UG',
        suppliedCurrency: 'UGX',
      }).ok,
    ).toBe(true);
    expect(
      evaluateDomesticContractCurrency({
        countryCode: 'NG',
        suppliedCurrency: 'NGN',
      }).ok,
    ).toBe(true);
  });

  it('is case-insensitive on the supplied currency', () => {
    const d = evaluateDomesticContractCurrency({
      countryCode: 'TZ',
      suppliedCurrency: 'tzs',
    });
    expect(d.ok).toBe(true);
  });

  it('fails closed when the tenant jurisdiction is missing', () => {
    const d = evaluateDomesticContractCurrency({
      countryCode: null,
      suppliedCurrency: 'TZS',
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe('DOMESTIC_CURRENCY_UNRESOLVED');
  });
});

describe('domesticCurrencyRejectionMessage', () => {
  it('returns bilingual EN + SW copy for a non-jurisdiction currency', () => {
    const d = evaluateDomesticContractCurrency({
      countryCode: 'TZ',
      suppliedCurrency: 'USD',
    });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      const msg = domesticCurrencyRejectionMessage(d);
      expect(msg.en).toContain('TZS');
      expect(msg.en).toContain('USD');
      expect(msg.sw.length).toBeGreaterThan(0);
      expect(msg.sw).toContain('TZS');
      // EN and SW must differ (no single-language leak).
      expect(msg.en).not.toEqual(msg.sw);
    }
  });

  it('returns bilingual copy for the unresolved-jurisdiction case', () => {
    const d = evaluateDomesticContractCurrency({
      countryCode: '',
      suppliedCurrency: 'TZS',
    });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      const msg = domesticCurrencyRejectionMessage(d);
      expect(msg.en.length).toBeGreaterThan(0);
      expect(msg.sw.length).toBeGreaterThan(0);
      expect(msg.en).not.toEqual(msg.sw);
    }
  });
});

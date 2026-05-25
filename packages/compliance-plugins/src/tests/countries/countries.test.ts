/**
 * Spot-tests for every new country profile. One smoke test per country +
 * coverage of the country-specific details that are most likely to drift.
 */

import { describe, expect, it } from 'vitest';

import {
  EXTENDED_PROFILES,
  GLOBAL_DEFAULT_PROFILE,
  australiaProfile,
  brazilProfile,
  canadaProfile,
  franceProfile,
  germanyProfile,
  getTenantCountryDefault,
  indiaProfile,
  japanProfile,
  koreaProfile,
  mexicoProfile,
  resolveExtendedProfile,
  singaporeProfile,
  uaeProfile,
  ukProfile,
} from '../../countries/index.js';

describe('country profile coverage', () => {
  it('exposes the 13 full-fidelity jurisdictions (12 PhJ-JURIS-BREADTH + TZ Wave 27)', () => {
    // Wave 27 Agent A/B: EXTENDED_PROFILES now layers 200+ ISO-3166 scaffolds
    // UNDER the full-fidelity profiles so every jurisdiction resolves to
    // *something*, and the hand-authored profiles still win for their ISO.
    // This test asserts the full-fidelity keys are present, not the whole
    // EXTENDED_PROFILES key count (which is >200 with scaffolds layered in).
    const fullFidelity = ['AE', 'AU', 'BR', 'CA', 'DE', 'FR', 'GB', 'IN', 'JP', 'KR', 'MX', 'SG', 'TZ'];
    for (const iso of fullFidelity) {
      expect(EXTENDED_PROFILES[iso]).toBeDefined();
    }
    // Sanity check: scaffolds layered in expand the key count well past 13.
    expect(Object.keys(EXTENDED_PROFILES).length).toBeGreaterThan(50);
  });

  it.each([
    ['DE', germanyProfile, 'EUR', 'de'],
    ['KR', koreaProfile, 'KRW', 'ko'],
    ['GB', ukProfile, 'GBP', 'en'],
    ['SG', singaporeProfile, 'SGD', 'en'],
    ['CA', canadaProfile, 'CAD', 'en'],
    ['AU', australiaProfile, 'AUD', 'en'],
    ['IN', indiaProfile, 'INR', 'en'],
    ['BR', brazilProfile, 'BRL', 'pt'],
    ['JP', japanProfile, 'JPY', 'ja'],
    ['FR', franceProfile, 'EUR', 'fr'],
    ['AE', uaeProfile, 'AED', 'ar'],
    ['MX', mexicoProfile, 'MXN', 'es'],
  ])('%s profile carries expected currency/language', (iso, profile, cur, lang) => {
    expect(profile.plugin.countryCode).toBe(iso);
    expect(profile.plugin.currencyCode).toBe(cur);
    expect(profile.languages[0]).toBe(lang);
  });

  it('zero-decimal currencies carry minorUnitDivisor = 1', () => {
    expect(japanProfile.minorUnitDivisor).toBe(1);
    expect(koreaProfile.minorUnitDivisor).toBe(1);
  });

  it('100-minor-unit currencies carry minorUnitDivisor = 100', () => {
    for (const iso of ['DE', 'GB', 'US', 'FR', 'IN', 'BR', 'CA', 'AU', 'SG', 'AE', 'MX']) {
      const p = EXTENDED_PROFILES[iso as keyof typeof EXTENDED_PROFILES];
      if (p) expect(p.minorUnitDivisor).toBe(100);
    }
  });
});

describe('tax-regime withholding', () => {
  it('DE applies 15.825% blended withholding', () => {
    const res = germanyProfile.taxRegime.calculateWithholding(
      100_000,
      'EUR',
      { kind: 'month', year: 2026, month: 4 }
    );
    expect(res.withholdingMinorUnits).toBe(15_825);
    expect(res.regulatorRef).toBe('DE-FINANZAMT-50a-EStG');
  });

  it('KR applies 20.42% withholding', () => {
    const res = koreaProfile.taxRegime.calculateWithholding(
      1_000_000,
      'KRW',
      { kind: 'month', year: 2026, month: 4 }
    );
    expect(res.withholdingMinorUnits).toBe(204_200);
  });

  it('GB applies 20% NRL withholding', () => {
    const res = ukProfile.taxRegime.calculateWithholding(
      50_000,
      'GBP',
      { kind: 'month', year: 2026, month: 4 }
    );
    expect(res.withholdingMinorUnits).toBe(10_000);
  });

  it('AE stubs withholding — no personal income tax', () => {
    const res = uaeProfile.taxRegime.calculateWithholding(
      100_000,
      'AED',
      { kind: 'month', year: 2026, month: 4 }
    );
    expect(res.withholdingMinorUnits).toBe(0);
    expect(res.requiresManualConfiguration).toBe(true);
  });

  it('AU stubs withholding — rental not withheld', () => {
    const res = australiaProfile.taxRegime.calculateWithholding(
      100_000,
      'AUD',
      { kind: 'month', year: 2026, month: 4 }
    );
    expect(res.requiresManualConfiguration).toBe(true);
  });
});

describe('national-id validators', () => {
  it('DE Personalausweis format', () => {
    expect(germanyProfile.nationalIdValidator?.validate('L01X00T47').status).toBe(
      'valid'
    );
    expect(germanyProfile.nationalIdValidator?.validate('too-short').status).toBe(
      'invalid'
    );
  });

  it('KR RRN is flagged PII sensitive', () => {
    const r = koreaProfile.nationalIdValidator?.validate('950101-1234567');
    expect(r?.status).toBe('valid');
    expect(r?.piiSensitive).toBe(true);
  });

  it('CA SIN accepts valid Luhn and rejects malformed', () => {
    // Classic valid test SIN: 046-454-286
    const r2 = canadaProfile.nationalIdValidator?.validate('046-454-286');
    expect(r2?.status).toBe('valid');
    // Definitely wrong digit count — not 9 digits.
    const r3 = canadaProfile.nationalIdValidator?.validate('abc-def-ghi');
    expect(r3?.status).toBe('invalid');
  });

  it('BR CPF rejects invalid checksum', () => {
    // 123.456.789-10 — commonly used invalid test CPF
    const r = brazilProfile.nationalIdValidator?.validate('123.456.789-10');
    expect(r?.status).toBe('invalid');
    // Valid test CPF: 111.444.777-35
    const ok = brazilProfile.nationalIdValidator?.validate('111.444.777-35');
    expect(ok?.status).toBe('valid');
  });

  it('IN PAN format', () => {
    expect(indiaProfile.nationalIdValidator?.validate('ABCDE1234F').status).toBe(
      'valid'
    );
    expect(indiaProfile.nationalIdValidator?.validate('bad').status).toBe(
      'invalid'
    );
  });
});

describe('lease-law port', () => {
  it('DE notice-windows differ by reason', () => {
    expect(germanyProfile.leaseLaw.noticeWindowDays('end-of-term')).toBe(90);
    expect(germanyProfile.leaseLaw.noticeWindowDays('non-payment')).toBe(14);
  });

  it('GB deposit cap uses weeks-of-rent', () => {
    const cap = ukProfile.leaseLaw.depositCapMultiple('residential-standard');
    expect(cap.maxWeeksOfRent).toBe(5);
  });

  it('KR rent-increase cap is 5% on renewal', () => {
    const cap = koreaProfile.leaseLaw.rentIncreaseCap('residential-standard');
    expect(cap.pctPerAnnum).toBe(5);
  });
});

describe('payment rails', () => {
  it('BR preferred rails include Pix first', () => {
    const rails = brazilProfile.paymentRails.listRails();
    expect(rails[0]?.id).toBe('pix');
  });

  it('IN rails include UPI', () => {
    const ids = indiaProfile.paymentRails.listRails().map((r) => r.id);
    expect(ids).toContain('upi');
  });

  it('SG rails include PayNow', () => {
    const ids = singaporeProfile.paymentRails.listRails().map((r) => r.id);
    expect(ids).toContain('paynow_sg');
  });

  it('AE rails include Careem Pay', () => {
    const ids = uaeProfile.paymentRails.listRails().map((r) => r.id);
    expect(ids).toContain('careem_pay');
  });
});

describe('global default fallback', () => {
  it('resolveExtendedProfile returns GLOBAL_DEFAULT_PROFILE for unknown', () => {
    expect(resolveExtendedProfile('XX')).toBe(GLOBAL_DEFAULT_PROFILE);
    expect(resolveExtendedProfile('')).toBe(GLOBAL_DEFAULT_PROFILE);
    expect(resolveExtendedProfile(null)).toBe(GLOBAL_DEFAULT_PROFILE);
  });

  it('resolveExtendedProfile resolves a known country', () => {
    expect(resolveExtendedProfile('de').plugin.countryCode).toBe('DE');
    expect(resolveExtendedProfile('JP').plugin.countryCode).toBe('JP');
  });

  it('getTenantCountryDefault returns a sensible hint', () => {
    expect(getTenantCountryDefault().length).toBe(2);
  });

  it('GLOBAL_DEFAULT_PROFILE has USD / en / manual rails', () => {
    expect(GLOBAL_DEFAULT_PROFILE.plugin.currencyCode).toBe('USD');
    expect(GLOBAL_DEFAULT_PROFILE.languages).toEqual(['en']);
    expect(GLOBAL_DEFAULT_PROFILE.nationalIdValidator).toBeNull();
  });
});

describe('phone normalization for new countries', () => {
  it.each([
    ['DE', germanyProfile, '030-12345678', '+493012345678'],
    ['KR', koreaProfile, '02-1234-5678', '+82212345678'],
    ['GB', ukProfile, '020 7946 0958', '+442079460958'],
    ['JP', japanProfile, '03-1234-5678', '+81312345678'],
    ['FR', franceProfile, '01 23 45 67 89', '+33123456789'],
  ])('%s normalizes to E.164', (_iso, profile, raw, expected) => {
    expect(profile.plugin.normalizePhone(raw)).toBe(expected);
  });
});

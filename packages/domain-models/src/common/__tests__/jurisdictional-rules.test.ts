import { describe, it, expect } from 'vitest';
import {
  getJurisdictionalRules,
  listSupportedJurisdictions,
} from '../jurisdictional-rules.js';

describe('getJurisdictionalRules — Tanzania', () => {
  it('returns the TZ entry with currency, dialing code, tax authority, and VAT rate', () => {
    const rules = getJurisdictionalRules('TZ');
    expect(rules.countryCode).toBe('TZ');
    expect(rules.defaultCurrency).toBe('TZS');
    expect(rules.e164CountryCode).toBe('+255');
    expect(rules.taxAuthority.code).toBe('TRA');
    expect(rules.taxAuthority.vatRatePct).toBe(18);
  });

  it('exposes Phase E.0 fields: working week, currency minor units, signature regime, phone plan, payment-due adjustment', () => {
    const rules = getJurisdictionalRules('TZ');
    expect(rules.workingWeek).toEqual({ start: 'mon', end: 'fri' });
    expect(rules.currencyMinorUnits).toBe(0); // TZS has no fractional unit
    expect(rules.eSignatureRegime.code).toBe('TZ-ETA');
    expect(rules.eSignatureRegime.legallyBinding).toBe(true);
    expect(rules.phoneNumberPlanLength).toEqual({ min: 9, max: 9 });
    expect(rules.paymentDueAdjustment).toBe('first-business-day-after');
  });

  it('exposes Phase E.0 fields: address format, KYC tiers, rent control, VAT-registration threshold', () => {
    const rules = getJurisdictionalRules('TZ');
    expect(rules.addressFormat.schema).toBe('tz');
    expect(rules.addressFormat.postalCodeRequired).toBe(false);
    expect(rules.addressFormat.postalCodeRegex?.test('14111')).toBe(true);
    expect(rules.kycTier.baseTier).toBe('simplified');
    expect(rules.kycTier.thresholdsUsdCents.length).toBeGreaterThanOrEqual(3);
    expect(rules.kycTier.thresholdsUsdCents[0]?.tier).toBe('standard');
    expect(rules.rentControlRegime.active).toBe(false);
    expect(rules.rentControlRegime.maxAnnualIncreasePct).toBeNull();
    expect(rules.vatRegistrationThresholdUsdCents).toBeGreaterThan(0);
  });

  it('returns a list of fixed-date statutory holidays for a given Gregorian year', () => {
    const rules = getJurisdictionalRules('TZ');
    const holidays2026 = rules.publicHolidays(2026);
    expect(holidays2026.length).toBeGreaterThan(0);
    // Year is interpolated into ISO dates
    expect(holidays2026.every((h) => h.date.startsWith('2026-'))).toBe(true);
    // Known fixed-date holidays
    const names = holidays2026.map((h) => h.name);
    expect(names).toContain("New Year's Day");
    expect(names).toContain('Union Day'); // 26 April — TZ-specific
    expect(names).toContain('Christmas Day');
  });
});

describe('getJurisdictionalRules — Kenya', () => {
  it('returns the KE entry with currency, dialing code, tax authority, and VAT rate', () => {
    const rules = getJurisdictionalRules('KE');
    expect(rules.countryCode).toBe('KE');
    expect(rules.defaultCurrency).toBe('KES');
    expect(rules.e164CountryCode).toBe('+254');
    expect(rules.taxAuthority.code).toBe('KRA');
    expect(rules.taxAuthority.vatRatePct).toBe(16);
  });

  it('exposes Phase E.0 fields: working week, currency minor units, signature regime, phone plan, payment-due adjustment', () => {
    const rules = getJurisdictionalRules('KE');
    expect(rules.workingWeek).toEqual({ start: 'mon', end: 'fri' });
    expect(rules.currencyMinorUnits).toBe(2); // KES has senti
    expect(rules.eSignatureRegime.code).toBe('KE-KICA');
    expect(rules.eSignatureRegime.legallyBinding).toBe(true);
    expect(rules.phoneNumberPlanLength).toEqual({ min: 9, max: 9 });
    expect(rules.paymentDueAdjustment).toBe('first-business-day-after');
  });

  it('exposes Phase E.0 fields: address format, KYC tiers, rent control, VAT-registration threshold', () => {
    const rules = getJurisdictionalRules('KE');
    expect(rules.addressFormat.schema).toBe('ke');
    expect(rules.addressFormat.postalCodeRequired).toBe(false);
    expect(rules.addressFormat.postalCodeRegex?.test('00100')).toBe(true);
    expect(rules.kycTier.baseTier).toBe('simplified');
    expect(rules.kycTier.thresholdsUsdCents.length).toBeGreaterThanOrEqual(3);
    expect(rules.rentControlRegime.active).toBe(true);
    expect(rules.rentControlRegime.notes).toMatch(/Cap\. 296/);
    expect(rules.vatRegistrationThresholdUsdCents).toBeGreaterThan(0);
  });

  it('returns a list of fixed-date statutory holidays for a given Gregorian year', () => {
    const rules = getJurisdictionalRules('KE');
    const holidays2026 = rules.publicHolidays(2026);
    expect(holidays2026.length).toBeGreaterThan(0);
    expect(holidays2026.every((h) => h.date.startsWith('2026-'))).toBe(true);
    const names = holidays2026.map((h) => h.name);
    expect(names).toContain('Madaraka Day');
    expect(names).toContain('Jamhuri Day');
    expect(names).toContain('Christmas Day');
  });
});

describe('getJurisdictionalRules — Nigeria', () => {
  it('returns the NG entry with currency, locale, timezone, dialing code, tax authority, and VAT rate', () => {
    const rules = getJurisdictionalRules('NG');
    expect(rules.countryCode).toBe('NG');
    expect(rules.countryName).toBe('Nigeria');
    expect(rules.defaultCurrency).toBe('NGN');
    expect(rules.defaultLocale).toBe('en-NG');
    expect(rules.defaultTimezone).toBe('Africa/Lagos');
    expect(rules.e164CountryCode).toBe('+234');
    expect(rules.taxAuthority.code).toBe('FIRS');
    expect(rules.taxAuthority.vatRatePct).toBe(7.5);
    expect(rules.identityDocType.code).toBe('NIN');
    expect(rules.landRegistry.code).toBe('NGGIS');
    expect(rules.bankRailProvider.code).toBe('NIBSS');
  });

  it('exposes Phase E.0 fields: working week, currency minor units, signature regime, phone plan, payment-due adjustment', () => {
    const rules = getJurisdictionalRules('NG');
    expect(rules.workingWeek).toEqual({ start: 'mon', end: 'fri' });
    expect(rules.currencyMinorUnits).toBe(2); // NGN has kobo
    expect(rules.eSignatureRegime.code).toBe('OTHER');
    expect(rules.eSignatureRegime.legallyBinding).toBe(true);
    expect(rules.eSignatureRegime.displayName).toMatch(/Evidence Act/);
    expect(rules.phoneNumberPlanLength).toEqual({ min: 10, max: 10 });
    expect(rules.paymentDueAdjustment).toBe('first-business-day-after');
  });

  it('exposes Phase E.0 fields: address format, KYC tiers, rent control, VAT-registration threshold', () => {
    const rules = getJurisdictionalRules('NG');
    expect(rules.addressFormat.schema).toBe('ng');
    expect(rules.addressFormat.postalCodeRequired).toBe(false);
    // NIPOST 6-digit postcode; first digit is region 1-9.
    expect(rules.addressFormat.postalCodeRegex?.test('100001')).toBe(true); // Ikeja HO
    expect(rules.addressFormat.postalCodeRegex?.test('900001')).toBe(true); // Garki HO
    expect(rules.addressFormat.postalCodeRegex?.test('000000')).toBe(false);
    expect(rules.addressFormat.postalCodeRegex?.test('12345')).toBe(false); // KE 5-digit
    expect(rules.kycTier.baseTier).toBe('simplified');
    expect(rules.kycTier.thresholdsUsdCents.length).toBeGreaterThanOrEqual(3);
    expect(rules.kycTier.thresholdsUsdCents[0]?.tier).toBe('standard');
    expect(rules.rentControlRegime.active).toBe(false);
    expect(rules.rentControlRegime.maxAnnualIncreasePct).toBeNull();
    expect(rules.rentControlRegime.notes).toMatch(/Lagos State Tenancy Law/);
    expect(rules.vatRegistrationThresholdUsdCents).toBeGreaterThan(0);
  });

  it('returns a list of fixed-date statutory holidays for a given Gregorian year', () => {
    const rules = getJurisdictionalRules('NG');
    const holidays2026 = rules.publicHolidays(2026);
    expect(holidays2026.length).toBeGreaterThanOrEqual(5);
    expect(holidays2026.every((h) => h.date.startsWith('2026-'))).toBe(true);
    const byDate = new Map(holidays2026.map((h) => [h.date, h.name]));
    expect(byDate.get('2026-10-01')).toBe('Independence Day');
    expect(byDate.get('2026-06-12')).toBe('Democracy Day');
    expect(byDate.get('2026-12-25')).toBe('Christmas Day');
    // 29 May is the historic (pre-2019) Democracy Day — must NOT
    // appear in the fixed-date list per Presidential Order of 6 Jun
    // 2019 moving Democracy Day to 12 June.
    expect(byDate.has('2026-05-29')).toBe(false);
  });

  it('triggers the KYC tier ladder at expected thresholds (USD cents)', () => {
    const rules = getJurisdictionalRules('NG');
    const ladder = rules.kycTier.thresholdsUsdCents;
    // First threshold is "standard"; final is "pep".
    expect(ladder[0]).toEqual({ above: 50_000, tier: 'standard' });
    expect(ladder[ladder.length - 1]).toEqual({ above: 5_000_000, tier: 'pep' });
    // Middle entry escalates to enhanced.
    expect(ladder.some((t) => t.tier === 'enhanced')).toBe(true);
  });
});

describe('Nigerian NIN regex', () => {
  it('accepts an 11-digit NIN and rejects shape mismatches', () => {
    const { identityDocType } = getJurisdictionalRules('NG');
    expect(identityDocType.numberRegex.test('12345678901')).toBe(true);
    // KE-style 7-9 digits — too short.
    expect(identityDocType.numberRegex.test('1234567890')).toBe(false);
    // KRA-PIN-style letter-bracketed token — wrong charset.
    expect(identityDocType.numberRegex.test('A123456789B')).toBe(false);
    // NIDA TZ-style 20-digit number — too long.
    expect(identityDocType.numberRegex.test('12345678901234567890')).toBe(false);
  });
});

describe('Nigerian phone regex', () => {
  it('matches a Nigerian E.164 mobile number and rejects neighbour codes', () => {
    const { phoneRegex } = getJurisdictionalRules('NG');
    expect(phoneRegex.test('+2348012345678')).toBe(true); // 0801* Airtel
    expect(phoneRegex.test('+2347031234567')).toBe(true); // 0703* MTN
    expect(phoneRegex.test('+2349013456789')).toBe(true); // 0901* Airtel
    // Kenyan number under +254 — must reject.
    expect(phoneRegex.test('+2547012345678')).toBe(false);
    // TZ number under +255 — must reject.
    expect(phoneRegex.test('+255712345678')).toBe(false);
  });

  it('also accepts the national-format (0…) entry', () => {
    const { phoneRegex } = getJurisdictionalRules('NG');
    expect(phoneRegex.test('08012345678')).toBe(true);
    expect(phoneRegex.test('07031234567')).toBe(true);
  });
});

describe('Phase E.0 contract — every supported jurisdiction populates all 10 new fields', () => {
  it('every entry has working-week, currency-minor-units, signature regime, address-format, KYC, rent-control, VAT threshold, payment-due adjustment, phone plan, and public-holidays fn', () => {
    for (const code of listSupportedJurisdictions()) {
      const rules = getJurisdictionalRules(code);
      expect(rules.workingWeek).toBeDefined();
      expect(typeof rules.workingWeek.start).toBe('string');
      expect(typeof rules.publicHolidays).toBe('function');
      expect(rules.publicHolidays(2026).length).toBeGreaterThan(0);
      expect(rules.eSignatureRegime).toBeDefined();
      expect(typeof rules.eSignatureRegime.legallyBinding).toBe('boolean');
      expect(rules.currencyMinorUnits).toBeGreaterThanOrEqual(0);
      expect(rules.currencyMinorUnits).toBeLessThanOrEqual(4);
      expect(rules.addressFormat).toBeDefined();
      expect(rules.kycTier).toBeDefined();
      expect(rules.kycTier.thresholdsUsdCents.length).toBeGreaterThan(0);
      expect(rules.rentControlRegime).toBeDefined();
      expect(typeof rules.rentControlRegime.active).toBe('boolean');
      expect(rules.vatRegistrationThresholdUsdCents).toBeGreaterThanOrEqual(0);
      expect(rules.paymentDueAdjustment).toMatch(
        /^(first-business-day-after|last-business-day-before|none)$/
      );
      expect(rules.phoneNumberPlanLength.min).toBeGreaterThan(0);
      expect(rules.phoneNumberPlanLength.max).toBeGreaterThanOrEqual(
        rules.phoneNumberPlanLength.min
      );
    }
  });
});

describe('getJurisdictionalRules — case-insensitive lookup', () => {
  it("treats 'tz' the same as 'TZ'", () => {
    const lower = getJurisdictionalRules('tz');
    const upper = getJurisdictionalRules('TZ');
    expect(lower).toBe(upper);
    expect(lower.countryCode).toBe('TZ');
    expect(lower.defaultCurrency).toBe('TZS');
  });
});

describe('getJurisdictionalRules — unknown country', () => {
  it('throws a descriptive error pointing to the registry file', () => {
    expect(() => getJurisdictionalRules('XX')).toThrowError(
      /packages\/domain-models\/src\/common\/jurisdictional-rules\.ts/
    );
    expect(() => getJurisdictionalRules('XX')).toThrowError(/'XX'/);
  });
});

describe('listSupportedJurisdictions', () => {
  it('returns the configured ISO 3166-1 alpha-2 codes', () => {
    const codes = [...listSupportedJurisdictions()].sort();
    expect(codes).toEqual(['KE', 'NG', 'TZ']);
  });
});

describe('Tanzania phone regex', () => {
  it('matches a Tanzanian E.164 number and rejects a Kenyan one', () => {
    const { phoneRegex } = getJurisdictionalRules('TZ');
    expect(phoneRegex.test('+255712345678')).toBe(true);
    expect(phoneRegex.test('+254712345678')).toBe(false);
  });
});

describe('Kenyan taxpayer-id (KRA PIN) regex', () => {
  it('matches a KRA PIN in KE context and rejects it in TZ context', () => {
    const ke = getJurisdictionalRules('KE');
    const tz = getJurisdictionalRules('TZ');
    expect(ke.taxAuthority.taxpayerIdRegex.test('A123456789B')).toBe(true);
    expect(tz.taxAuthority.taxpayerIdRegex.test('A123456789B')).toBe(false);
  });
});

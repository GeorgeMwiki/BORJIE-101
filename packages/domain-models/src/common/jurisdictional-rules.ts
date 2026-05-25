/**
 * Per-country jurisdictional rules — the single source of truth for every
 * place the platform needs to vary behaviour by country (currency, locale,
 * phone format, tax authority + VAT rate, ID document, payment rails,
 * lease law, data-protection statute).
 *
 * Why a separate module from `region-config.ts`?
 *   `region-config.ts` is the *legacy* RegionConfig shape (founder-era
 *   East-African defaults + a Zod schema for phone/taxpayer-id). It is
 *   battle-tested and woven into the rest of the platform.
 *
 *   This module is the *new* contract for adding a jurisdiction WITHOUT
 *   touching any code path: every business rule that used to be hard-
 *   coded behind `if (country === 'TZ')` can read its parameter from
 *   `getJurisdictionalRules(country)`. Adding a country is now a single-
 *   object edit.
 *
 *   The two modules overlap intentionally — `region-config.ts` will be
 *   migrated to read from this table in Phase E. For now they coexist
 *   and the values are kept consistent.
 *
 * Sources (May 2026):
 *   TZ — TRA, NIDA, eArdhi, M-Pesa Tanzania (Vodacom), Airtel Money,
 *        Halotel Pesa, GePG; VAT 18 %; PDPA 2022 (PDPC); monthly MRI.
 *   KE — KRA, Huduma Namba (National ID fallback), Ardhisasa, M-Pesa
 *        Safaricom, Airtel Money, T-Kash, PesaLink; VAT 16 %; DPA 2019
 *        (ODPC); monthly MRI.
 *
 * Add a jurisdiction: append an entry to `RULES_BY_COUNTRY`. That is
 * intentionally the *only* required edit — no `if` branch anywhere else.
 */

import type { CurrencyCode } from './types.js';

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export interface JurisdictionalIdentityDocType {
  readonly code: string;
  readonly displayName: string;
  readonly verifierMcpServer: string;
  readonly numberRegex: RegExp;
}

export interface JurisdictionalTaxAuthority {
  readonly code: string;
  readonly displayName: string;
  readonly portalUrl: string;
  readonly mriFilingFrequency: 'monthly' | 'quarterly' | 'annual';
  readonly vatRatePct: number;
  readonly taxpayerIdRegex: RegExp;
}

export interface JurisdictionalLandRegistry {
  readonly code: string;
  readonly displayName: string;
  readonly mcpServer: string;
}

export interface JurisdictionalMobileMoneyProvider {
  readonly provider: string;
  readonly mcpServer: string;
  readonly nationalReachPct: number;
}

export interface JurisdictionalBankRailProvider {
  readonly code: string;
  readonly displayName: string;
}

export interface JurisdictionalLeaseRules {
  readonly minNoticeDays: {
    readonly quit: number;
    readonly eviction: number;
    readonly rentIncrease: number;
  };
  readonly maxSecurityDepositMonths: number;
  readonly statutoryGracePeriodDays: number;
  readonly habitabilityStandardsRef: string;
}

export interface JurisdictionalDataProtection {
  readonly statuteName: string;
  readonly regulatorName: string;
  readonly breachNotifyHours: number;
  readonly dataLocalizationRequired: boolean;
}

// ---------------------------------------------------------------------------
// Phase E.0 — 10 new fields (working-week, public holidays, e-signature
// regime, currency minor-units, address-format, KYC tiers, rent-control,
// VAT-registration threshold, payment-due adjustment, phone-plan length).
// Each is wired so a Phase E.0.4 rebind pass can replace existing
// `if (country === 'TZ')` branches with a single getJurisdictionalRules
// call. See JURISDICTIONAL-RULES.md for the full contract documentation.
// ---------------------------------------------------------------------------

export interface JurisdictionalWorkingWeek {
  /** First day of the local working week. TZ/KE: 'mon'; Gulf states: 'sun'. */
  readonly start: 'sun' | 'mon';
  /** Last day of the local working week. TZ/KE: 'fri'; Gulf states: 'thu'. */
  readonly end: 'thu' | 'fri' | 'sat';
}

export interface JurisdictionalPublicHoliday {
  /** ISO-8601 date in the country's local calendar (YYYY-MM-DD). */
  readonly date: string;
  readonly name: string;
}

export interface JurisdictionalESignatureRegime {
  readonly code:
    | 'eIDAS'
    | 'ESIGN'
    | 'UETA'
    | 'ETA'
    | 'TZ-ETA'
    | 'KE-KICA'
    | 'OTHER';
  readonly displayName: string;
  readonly legallyBinding: boolean;
}

export interface JurisdictionalAddressFormat {
  readonly schema: 'us' | 'uk' | 'tz' | 'ke' | 'ng' | 'jp' | 'generic';
  readonly postalCodeRequired: boolean;
  readonly postalCodeRegex: RegExp | null;
}

export interface JurisdictionalKycTier {
  readonly baseTier: 'simplified' | 'standard' | 'enhanced';
  /**
   * Threshold ladder ordered by `above` (USD minor units, i.e. cents) —
   * a customer whose monthly throughput exceeds `above` is escalated to
   * `tier`. The highest-matching entry wins.
   */
  readonly thresholdsUsdCents: ReadonlyArray<{
    readonly above: number;
    readonly tier: 'standard' | 'enhanced' | 'pep';
  }>;
}

export interface JurisdictionalRentControlRegime {
  readonly active: boolean;
  readonly maxAnnualIncreasePct: number | null;
  readonly notes: string;
}

export interface JurisdictionalPhoneNumberPlan {
  /** Subscriber-number length (not including +CC). TZ/KE: min 9, max 9. */
  readonly min: number;
  readonly max: number;
}

export interface JurisdictionalRules {
  readonly countryCode: string;
  readonly countryName: string;
  readonly defaultCurrency: CurrencyCode;
  readonly defaultLocale: string;
  readonly defaultTimezone: string;
  readonly awsRegionDefault: string;
  readonly e164CountryCode: string;
  readonly phoneRegex: RegExp;
  readonly identityDocType: JurisdictionalIdentityDocType;
  readonly taxAuthority: JurisdictionalTaxAuthority;
  readonly landRegistry: JurisdictionalLandRegistry;
  readonly mobileMoney: ReadonlyArray<JurisdictionalMobileMoneyProvider>;
  readonly bankRailProvider: JurisdictionalBankRailProvider;
  readonly leaseRules: JurisdictionalLeaseRules;
  readonly dataProtection: JurisdictionalDataProtection;
  // ---- Phase E.0 expansion (10 new fields) ----
  readonly workingWeek: JurisdictionalWorkingWeek;
  /**
   * Recurrence-driven public-holiday calendar. Given a Gregorian year,
   * returns the country's observed statutory holidays (fixed-date +
   * any computed religious / Easter-anchored entries the country
   * recognises). Implementations are pure & memoisable.
   */
  readonly publicHolidays: (
    year: number
  ) => ReadonlyArray<JurisdictionalPublicHoliday>;
  readonly eSignatureRegime: JurisdictionalESignatureRegime;
  /** ISO-4217 minor-unit exponent. TZS: 0, KES: 2, JPY: 0, BHD: 3. */
  readonly currencyMinorUnits: number;
  readonly addressFormat: JurisdictionalAddressFormat;
  readonly kycTier: JurisdictionalKycTier;
  readonly rentControlRegime: JurisdictionalRentControlRegime;
  /** Annual revenue (USD minor units) that triggers VAT registration. */
  readonly vatRegistrationThresholdUsdCents: number;
  /**
   * When a payment due-date falls on a weekend / public holiday, which
   * business day applies. TZ/KE follow `first-business-day-after`.
   */
  readonly paymentDueAdjustment:
    | 'first-business-day-after'
    | 'last-business-day-before'
    | 'none';
  readonly phoneNumberPlanLength: JurisdictionalPhoneNumberPlan;
}

// ---------------------------------------------------------------------------
// Tanzania
// ---------------------------------------------------------------------------

const TZ_RULES: JurisdictionalRules = Object.freeze({
  countryCode: 'TZ',
  countryName: 'Tanzania',
  defaultCurrency: 'TZS',
  defaultLocale: 'sw-TZ',
  defaultTimezone: 'Africa/Dar_es_Salaam',
  // eu-west-1 (Ireland) is the closest currently-GA AWS region to East
  // Africa with full service parity; af-south-1 (Cape Town) lacks several
  // services we rely on. Revisit when AWS opens an East-Africa region.
  awsRegionDefault: 'eu-west-1',
  e164CountryCode: '+255',
  // E.164 (+255 7XX XXX XXX | +255 6XX XXX XXX) OR national (07XX/06XX).
  phoneRegex: /^(?:\+255|0)[67]\d{8}$/,
  identityDocType: Object.freeze({
    code: 'NIDA',
    displayName: 'National Identification Authority Number',
    verifierMcpServer: '@borjie/mcp-nida',
    // NIDA NIN: 20 digits.
    numberRegex: /^\d{20}$/,
  }),
  taxAuthority: Object.freeze({
    code: 'TRA',
    displayName: 'Tanzania Revenue Authority',
    portalUrl: 'https://www.tra.go.tz',
    mriFilingFrequency: 'monthly',
    vatRatePct: 18,
    // TRA TIN: 9 digits.
    taxpayerIdRegex: /^\d{9}$/,
  }),
  landRegistry: Object.freeze({
    code: 'EARDHI',
    displayName: 'Wizara ya Ardhi — eArdhi',
    mcpServer: '@borjie/mcp-eardhi',
  }),
  mobileMoney: Object.freeze([
    Object.freeze({
      provider: 'M-Pesa',
      mcpServer: '@borjie/mcp-mpesa-tz',
      nationalReachPct: 45,
    }),
    Object.freeze({
      provider: 'Airtel Money',
      mcpServer: '@borjie/mcp-airtel-money-tz',
      nationalReachPct: 28,
    }),
    Object.freeze({
      provider: 'Halotel Pesa',
      mcpServer: '@borjie/mcp-halotel-pesa',
      nationalReachPct: 7,
    }),
  ]),
  bankRailProvider: Object.freeze({
    code: 'GePG',
    displayName: 'Government Electronic Payment Gateway',
  }),
  leaseRules: Object.freeze({
    minNoticeDays: Object.freeze({
      quit: 90,
      eviction: 90,
      rentIncrease: 30,
    }),
    maxSecurityDepositMonths: 6,
    statutoryGracePeriodDays: 14,
    habitabilityStandardsRef: 'Land Act 1999 (Cap. 113) §83 + Local Government (Urban Authorities) Act §55',
  }),
  dataProtection: Object.freeze({
    statuteName: 'Personal Data Protection Act 2022',
    regulatorName: 'Personal Data Protection Commission (PDPC)',
    breachNotifyHours: 72,
    dataLocalizationRequired: true,
  }),
  // ---- Phase E.0 fields ----
  workingWeek: Object.freeze({ start: 'mon', end: 'fri' }),
  // Fixed-date statutory holidays per the Public Holidays Act (Cap. 35)
  // — religious-calendar entries (Eid al-Fitr, Eid al-Hajj, Good Friday,
  // Easter Monday, Maulid) are NOT included here yet because they vary
  // year-on-year and require a Hijri/Easter computus; tracked for Phase
  // E follow-up. The fixed list below covers the legally guaranteed
  // 11 fixed-date observances.
  publicHolidays: (year: number) =>
    Object.freeze([
      Object.freeze({ date: `${year}-01-01`, name: "New Year's Day" }),
      Object.freeze({
        date: `${year}-01-12`,
        name: 'Zanzibar Revolution Day',
      }),
      Object.freeze({
        date: `${year}-04-07`,
        name: 'Karume Day (Sheikh Abeid Karume)',
      }),
      Object.freeze({ date: `${year}-04-26`, name: 'Union Day' }),
      Object.freeze({ date: `${year}-05-01`, name: 'Labour Day' }),
      Object.freeze({ date: `${year}-07-07`, name: 'Saba Saba Day' }),
      Object.freeze({ date: `${year}-08-08`, name: 'Nane Nane (Farmers Day)' }),
      Object.freeze({
        date: `${year}-10-14`,
        name: 'Mwalimu Nyerere Memorial Day',
      }),
      Object.freeze({ date: `${year}-12-09`, name: 'Independence Day' }),
      Object.freeze({ date: `${year}-12-25`, name: 'Christmas Day' }),
      Object.freeze({ date: `${year}-12-26`, name: 'Boxing Day' }),
    ]),
  // Electronic & Postal Communications (Electronic Transactions) Act,
  // 2015 — Sections 4-6 grant equivalence of paper signatures provided
  // method-of-identification + integrity test passes. Aliased 'TZ-ETA'.
  eSignatureRegime: Object.freeze({
    code: 'TZ-ETA',
    displayName: 'Electronic Transactions Act 2015 (Tanzania)',
    legallyBinding: true,
  }),
  // ISO-4217 lists TZS with 0 decimals (no fractional unit in
  // circulation — the senti was demonetised; smallest note is TSh 500).
  currencyMinorUnits: 0,
  addressFormat: Object.freeze({
    schema: 'tz',
    postalCodeRequired: false,
    // TZ has a 5-digit postal-code system (TPN) but adoption is patchy
    // and most addresses still use the P.O. Box convention; we record
    // the regex for the rare cases that do supply it.
    postalCodeRegex: /^\d{5}$/,
  }),
  kycTier: Object.freeze({
    baseTier: 'simplified',
    // Aligned with FIU-TZ guidance (POCAMLA 2006 + AML Regs 2012):
    // simplified KYC for amounts under USD 1k/mo; standard above that;
    // enhanced + PEP screening above USD 10k/mo. Values in USD cents.
    thresholdsUsdCents: Object.freeze([
      Object.freeze({ above: 100_000, tier: 'standard' as const }),
      Object.freeze({ above: 1_000_000, tier: 'enhanced' as const }),
      Object.freeze({ above: 5_000_000, tier: 'pep' as const }),
    ]),
  }),
  // Rent Restriction Act (Cap. 339) was repealed in 2005 — TZ has no
  // active rent-cap regime; market-rate increases are permitted subject
  // to the 30-day notice in `leaseRules`.
  rentControlRegime: Object.freeze({
    active: false,
    maxAnnualIncreasePct: null,
    notes: 'Rent Restriction Act repealed 2005. Market-rate increases permitted with 30-day written notice.',
  }),
  // TRA VAT registration threshold: TSh 200 million annual turnover
  // (~USD 79k at mid-2026 FX). Stored as USD cents for cross-country
  // comparability and shielded from FX drift at lookup time.
  vatRegistrationThresholdUsdCents: 7_900_000,
  paymentDueAdjustment: 'first-business-day-after',
  // Tanzanian subscriber numbers are always 9 digits after +255.
  phoneNumberPlanLength: Object.freeze({ min: 9, max: 9 }),
});

// ---------------------------------------------------------------------------
// Kenya
// ---------------------------------------------------------------------------

const KE_RULES: JurisdictionalRules = Object.freeze({
  countryCode: 'KE',
  countryName: 'Kenya',
  defaultCurrency: 'KES',
  defaultLocale: 'en-KE',
  defaultTimezone: 'Africa/Nairobi',
  // Same rationale as TZ — eu-west-1 is the nearest GA region with full
  // service parity. af-south-1 lacks several services.
  awsRegionDefault: 'eu-west-1',
  e164CountryCode: '+254',
  // E.164 (+254 7XX/1XX XXX XXX) OR national (07XX/01XX).
  phoneRegex: /^(?:\+254|0)[17]\d{8}$/,
  identityDocType: Object.freeze({
    code: 'HUDUMA',
    displayName: 'Huduma Namba (National ID Number)',
    verifierMcpServer: '@borjie/mcp-huduma',
    // Kenyan National ID: 7 or 8 digits (Huduma Namba is a unique 9-digit
    // identifier built on the same base; accept either).
    numberRegex: /^\d{7,9}$/,
  }),
  taxAuthority: Object.freeze({
    code: 'KRA',
    displayName: 'Kenya Revenue Authority',
    portalUrl: 'https://itax.kra.go.ke',
    mriFilingFrequency: 'monthly',
    vatRatePct: 16,
    // KRA PIN: letter + 9 digits + letter, e.g. A123456789B.
    taxpayerIdRegex: /^[A-Z]\d{9}[A-Z]$/,
  }),
  landRegistry: Object.freeze({
    code: 'ARDHISASA',
    displayName: 'Ministry of Lands — Ardhisasa',
    mcpServer: '@borjie/mcp-ardhisasa',
  }),
  mobileMoney: Object.freeze([
    Object.freeze({
      provider: 'M-Pesa',
      mcpServer: '@borjie/mcp-mpesa-ke',
      nationalReachPct: 96,
    }),
    Object.freeze({
      provider: 'Airtel Money',
      mcpServer: '@borjie/mcp-airtel-money-ke',
      nationalReachPct: 3,
    }),
    Object.freeze({
      provider: 'T-Kash',
      mcpServer: '@borjie/mcp-tkash',
      nationalReachPct: 1,
    }),
  ]),
  bankRailProvider: Object.freeze({
    code: 'PESALINK',
    displayName: 'PesaLink (Integrated Payment Services Ltd)',
  }),
  leaseRules: Object.freeze({
    minNoticeDays: Object.freeze({
      quit: 60,
      eviction: 60,
      rentIncrease: 90,
    }),
    maxSecurityDepositMonths: 2,
    statutoryGracePeriodDays: 14,
    habitabilityStandardsRef: 'Landlord and Tenant (Shops, Hotels and Catering Establishments) Act Cap. 301 + Rent Restriction Act Cap. 296',
  }),
  dataProtection: Object.freeze({
    statuteName: 'Data Protection Act 2019',
    regulatorName: 'Office of the Data Protection Commissioner (ODPC)',
    breachNotifyHours: 72,
    dataLocalizationRequired: false,
  }),
  // ---- Phase E.0 fields ----
  workingWeek: Object.freeze({ start: 'mon', end: 'fri' }),
  // Public Holidays Act, Cap. 110 — fixed-date entries only. Movable
  // observances (Good Friday, Easter Monday, Eid al-Fitr, Eid al-Adha)
  // require Easter computus + Hijri lookup; tracked for Phase E follow-up.
  publicHolidays: (year: number) =>
    Object.freeze([
      Object.freeze({ date: `${year}-01-01`, name: "New Year's Day" }),
      Object.freeze({ date: `${year}-05-01`, name: 'Labour Day' }),
      Object.freeze({ date: `${year}-06-01`, name: 'Madaraka Day' }),
      Object.freeze({ date: `${year}-10-10`, name: 'Huduma Day' }),
      Object.freeze({
        date: `${year}-10-20`,
        name: 'Mashujaa Day (Heroes Day)',
      }),
      Object.freeze({ date: `${year}-12-12`, name: 'Jamhuri Day' }),
      Object.freeze({ date: `${year}-12-25`, name: 'Christmas Day' }),
      Object.freeze({
        date: `${year}-12-26`,
        name: 'Utamaduni Day (Boxing Day)',
      }),
    ]),
  // Kenya Information & Communications Act, Cap. 411A (KICA) — Section
  // 83 grants electronic signatures the same legal effect as wet
  // signatures provided uniqueness + signer-linkage + integrity hold.
  eSignatureRegime: Object.freeze({
    code: 'KE-KICA',
    displayName: 'Kenya Information & Communications Act Cap. 411A',
    legallyBinding: true,
  }),
  // ISO-4217 KES = 2 decimal places (the senti is still legal tender,
  // though no coin smaller than KSh 1 is commonly circulated).
  currencyMinorUnits: 2,
  addressFormat: Object.freeze({
    schema: 'ke',
    postalCodeRequired: false,
    // KE postal codes are 5 digits, e.g. 00100 (Nairobi GPO).
    postalCodeRegex: /^\d{5}$/,
  }),
  kycTier: Object.freeze({
    baseTier: 'simplified',
    // CBK Prudential Guideline CBK/PG/08 + Proceeds of Crime & Anti-
    // Money Laundering Act (POCAMLA) thresholds — simplified up to
    // ~USD 1k/mo, standard up to ~USD 10k/mo, enhanced + PEP screen
    // above that. Values in USD cents.
    thresholdsUsdCents: Object.freeze([
      Object.freeze({ above: 100_000, tier: 'standard' as const }),
      Object.freeze({ above: 1_000_000, tier: 'enhanced' as const }),
      Object.freeze({ above: 5_000_000, tier: 'pep' as const }),
    ]),
  }),
  // Rent Restriction Act (Cap. 296) caps annual increases on protected
  // tenancies (controlled rents below KSh 2,500/month — effectively
  // legacy stock); modern leases are governed by the L&T (Shops,
  // Hotels & Catering) Act Cap. 301 with 90-day notice but no cap on
  // increase percentage. Flag as `active: true` to retain awareness;
  // `maxAnnualIncreasePct: null` signals "case-by-case via tribunal".
  rentControlRegime: Object.freeze({
    active: true,
    maxAnnualIncreasePct: null,
    notes: 'Rent Restriction Act Cap. 296 protects controlled tenancies below KSh 2,500/mo; modern leases under L&T Act Cap. 301 require 90-day notice but no statutory cap on increase percentage. Disputes go to the Rent Restriction Tribunal.',
  }),
  // KRA VAT registration threshold: KSh 5 million annual turnover
  // (~USD 38.5k at mid-2026 FX). Stored as USD cents.
  vatRegistrationThresholdUsdCents: 3_850_000,
  paymentDueAdjustment: 'first-business-day-after',
  // Kenyan subscriber numbers are always 9 digits after +254.
  phoneNumberPlanLength: Object.freeze({ min: 9, max: 9 }),
});

// ---------------------------------------------------------------------------
// Nigeria
// ---------------------------------------------------------------------------

const NG_RULES: JurisdictionalRules = Object.freeze({
  countryCode: 'NG',
  countryName: 'Nigeria',
  defaultCurrency: 'NGN',
  defaultLocale: 'en-NG',
  defaultTimezone: 'Africa/Lagos',
  // af-south-1 (Cape Town) is currently the closest GA AWS region to
  // West Africa; eu-west-1 (Ireland) remains an option when wider
  // service parity is required. Revisit when AWS opens a West-Africa
  // region (Lagos local-zone candidate per AWS 2025 roadmap).
  awsRegionDefault: 'af-south-1',
  e164CountryCode: '+234',
  // Nigerian mobile NSN: 10 digits beginning [7|8|9][0|1] — covers the
  // full GSM prefix space (070*, 071*, 080*, 081*, 090*, 091*) for MTN,
  // Glo, Airtel, 9mobile (NCC Numbering Plan, May 2026). Mobile-number
  // portability (2013) means prefixes don't reliably identify carrier.
  // E.164 (+234 7XX/8XX/9XX XXX XXXX) OR national (07XX/08XX/09XX).
  phoneRegex: /^(?:\+234|0)[789][01]\d{8}$/,
  identityDocType: Object.freeze({
    code: 'NIN',
    displayName: 'National Identification Number (NIN)',
    verifierMcpServer: '@borjie/mcp-server-nin',
    // NIMC NIN: 11 random digits + Verhoeff checksum (full validation
    // happens in the MCP server; the regex only enforces shape).
    // https://nimc.gov.ng/nin
    numberRegex: /^\d{11}$/,
  }),
  taxAuthority: Object.freeze({
    code: 'FIRS',
    displayName: 'Federal Inland Revenue Service / Nigeria Revenue Service',
    portalUrl: 'https://taxpromax.firs.gov.ng',
    mriFilingFrequency: 'monthly',
    // Finance Act 2020 raised VAT from 5% to 7.5% effective 01 Feb 2020.
    vatRatePct: 7.5,
    // Legacy FIRS TIN = 12 digits (numeric). The Nigeria Tax Act 2025
    // introduced a new 13-digit NRS Tax ID effective 01 Jan 2026,
    // derived from NIN (individuals) or CAC RC number (companies).
    // Accept either era; the FIRS verify_tin MCP tool disambiguates.
    taxpayerIdRegex: /^\d{12,13}$/,
  }),
  landRegistry: Object.freeze({
    code: 'NGGIS',
    displayName: 'National Geospatial Information System (federal aggregator over LASRRA / ABGIS / state deeds registries)',
    mcpServer: '@borjie/mcp-server-nggis',
  }),
  mobileMoney: Object.freeze([
    // 2026 reach estimates per CBN Q1-2026 Mobile Money Operator
    // returns + sector reporting (TechCabal, Innovation Village):
    // OPay ~40 % daily-active share, PalmPay ~25 %, Moniepoint ~20 %.
    Object.freeze({
      provider: 'OPay',
      mcpServer: '@borjie/mcp-server-opay',
      nationalReachPct: 40,
    }),
    Object.freeze({
      provider: 'PalmPay',
      mcpServer: '@borjie/mcp-server-palmpay',
      nationalReachPct: 25,
    }),
    Object.freeze({
      provider: 'Moniepoint',
      mcpServer: '@borjie/mcp-server-moniepoint',
      nationalReachPct: 20,
    }),
  ]),
  bankRailProvider: Object.freeze({
    code: 'NIBSS',
    displayName: 'Nigeria Inter-Bank Settlement System (NIP / Instant Payment)',
  }),
  leaseRules: Object.freeze({
    // Recovery of Premises Act (FCT Cap. 544 LFN 1990) + Lagos State
    // Tenancy Law 2011 §13: yearly tenancies and above require six
    // months written notice; monthly tenancies require one month;
    // weekly tenancies one week. We surface the longest (yearly) as
    // the conservative default; per-tenant overrides happen at the
    // lease-domain layer.
    minNoticeDays: Object.freeze({
      quit: 180,
      eviction: 180,
      rentIncrease: 30,
    }),
    // No federal statutory cap; Lagos market norm is 6-12 months
    // rent in advance + 1-2 months caution deposit. Lagos State
    // Tenancy Law 2011 §4 prohibits demanding more than 6 months
    // rent in advance from a sitting tenant.
    maxSecurityDepositMonths: 6,
    // After expiry of notice to quit, RPA + Lagos Tenancy Law §16
    // require a further 7-day owner's-intention notice before suit.
    statutoryGracePeriodDays: 7,
    habitabilityStandardsRef: 'Recovery of Premises Act Cap. 544 LFN 1990 + Lagos State Tenancy Law No. 14 of 2011 §13',
  }),
  dataProtection: Object.freeze({
    statuteName: 'Nigeria Data Protection Act 2023',
    regulatorName: 'Nigeria Data Protection Commission (NDPC)',
    // NDPA 2023 §40(2): controllers must notify NDPC within 72 hours of
    // becoming aware of a high-risk personal-data breach.
    breachNotifyHours: 72,
    // NDPA does not impose a blanket localisation requirement; cross-
    // border transfer is permitted on the §41 grounds (adequacy /
    // SCC-equivalent / data-subject consent). Sector-specific rules
    // (CBN, NCC) impose narrower localisation for fintech and telecoms
    // metadata, but those live in the connector layer, not here.
    dataLocalizationRequired: false,
  }),
  // ---- Phase E.0 fields ----
  workingWeek: Object.freeze({ start: 'mon', end: 'fri' }),
  // Public Holidays Act Cap. P40 LFN 2004 — fixed-date statutory
  // observances. Movable Islamic holidays (Eid al-Fitr, Eid al-Adha,
  // Eid el-Maulud) and Christian movable feasts (Good Friday, Easter
  // Monday) require Hijri lookup + Easter computus and are tracked
  // for Phase E.5.5. Note: 29-May was the previous Democracy Day
  // (1999-2018); since 2019 (Order signed by President Buhari, 6 Jun
  // 2019) Democracy Day moved to 12 June to honour the annulled 1993
  // election — 29-May is NO LONGER a federal public holiday.
  publicHolidays: (year: number) =>
    Object.freeze([
      Object.freeze({ date: `${year}-01-01`, name: "New Year's Day" }),
      Object.freeze({ date: `${year}-05-01`, name: "Workers' Day" }),
      Object.freeze({ date: `${year}-06-12`, name: 'Democracy Day' }),
      Object.freeze({ date: `${year}-10-01`, name: 'Independence Day' }),
      Object.freeze({ date: `${year}-12-25`, name: 'Christmas Day' }),
      Object.freeze({ date: `${year}-12-26`, name: 'Boxing Day' }),
    ]),
  // Evidence Act 2011 §84 grants electronic signatures admissibility
  // and presumptive equivalence to wet signatures provided the
  // reliability tests in §84(2) hold. No bespoke statute code in our
  // enum yet; reuse 'OTHER' with a descriptive displayName.
  eSignatureRegime: Object.freeze({
    code: 'OTHER',
    displayName: 'Evidence Act 2011 §84 (Nigeria)',
    legallyBinding: true,
  }),
  // ISO-4217 NGN = 2 decimal places (kobo). The kobo is rarely
  // circulated as coin but remains legal tender for accounting.
  currencyMinorUnits: 2,
  addressFormat: Object.freeze({
    schema: 'ng',
    postalCodeRequired: false,
    // NIPOST 6-digit postcode (first digit = NIPOST region 1-9; lowest
    // observed code is 100001 — Ikeja HO Lagos). Adoption is patchy
    // outside the federal capital and Lagos so the field is optional.
    postalCodeRegex: /^[1-9]\d{5}$/,
  }),
  kycTier: Object.freeze({
    baseTier: 'simplified',
    // CBN AML/CFT/CPF Regulations 2022 + NDIC 3-tier KYC framework:
    // Tier 1 (simplified) up to ~USD 500/mo; Tier 2 (standard) up to
    // ~USD 5k/mo; Tier 3 (enhanced) above that; PEP screening above
    // ~USD 50k/mo per Financial Action Task Force (FATF) guidance.
    // Values in USD cents — looked up at runtime and converted to
    // NGN at the prevailing CBN reference rate.
    thresholdsUsdCents: Object.freeze([
      Object.freeze({ above: 50_000, tier: 'standard' as const }),
      Object.freeze({ above: 500_000, tier: 'enhanced' as const }),
      Object.freeze({ above: 5_000_000, tier: 'pep' as const }),
    ]),
  }),
  // No federal rent-control regime. Lagos State Tenancy Law 2011 §37
  // caps rent increases to "reasonable" and lets tenants challenge
  // arbitrary hikes in the Magistrate Court (tribunal route for
  // commercial). Flag inactive (no statutory percentage cap) and
  // record the soft-cap rationale for downstream UI surfaces.
  rentControlRegime: Object.freeze({
    active: false,
    maxAnnualIncreasePct: null,
    notes: 'No federal rent control. Lagos State Tenancy Law 2011 §37 caps increases to "reasonable" — disputes go to the Magistrate Court (or High Court for rents above NGN 10M).',
  }),
  // FIRS VAT registration threshold: NGN 25 million annual turnover
  // (Finance Act 2019 §15) — approx USD 16k at mid-2026 CBN window
  // rate (NGN ~1,550/USD). Stored as USD cents for cross-country
  // comparability.
  vatRegistrationThresholdUsdCents: 1_600_000,
  paymentDueAdjustment: 'first-business-day-after',
  // Nigerian NSN is always 10 digits after +234 (NCC Numbering Plan).
  phoneNumberPlanLength: Object.freeze({ min: 10, max: 10 }),
});

// ---------------------------------------------------------------------------
// Registry + lookup
// ---------------------------------------------------------------------------

const RULES_BY_COUNTRY: Readonly<Record<string, JurisdictionalRules>> =
  Object.freeze({
    TZ: TZ_RULES,
    KE: KE_RULES,
    NG: NG_RULES,
  });

/**
 * Look up jurisdictional rules for a country.
 *
 * Case-insensitive (`'tz'` → `'TZ'`). Throws a descriptive error pointing
 * to the registry file so adding a jurisdiction has a single discoverable
 * edit site.
 */
export function getJurisdictionalRules(countryCode: string): JurisdictionalRules {
  const upper = countryCode.toUpperCase();
  const rules = RULES_BY_COUNTRY[upper];
  if (!rules) {
    throw new Error(
      `No jurisdictional rules for country '${countryCode}'. Add an entry to packages/domain-models/src/common/jurisdictional-rules.ts.`
    );
  }
  return rules;
}

/**
 * List the ISO 3166-1 alpha-2 codes that have a jurisdictional-rules
 * entry. Returns codes in registry order, frozen.
 */
export function listSupportedJurisdictions(): ReadonlyArray<string> {
  return Object.freeze(Object.keys(RULES_BY_COUNTRY));
}

/**
 * Tanzania (TZ) — first-class country profile.
 *
 * This file IS the Tanzania-specific country plugin. NIDA, TRA, M-Pesa,
 * GePG, +255, and Africa/Dar_es_Salaam literals here are by design — the
 * country is the file's identity. The cross-country registry lives at
 * packages/domain-models/src/common/jurisdictional-rules.ts; this file
 * implements the TZ port that consumers reach through that registry.
 * Allowlisted in the lint rule + audit script by directory pattern.
 *
 *
 * ============================================================================
 * TAX REGIME — Tanzania Revenue Authority (TRA)
 * ============================================================================
 * Source: Income Tax Act, Cap. 332 (R.E. 2019, consolidating Act No. 11 of
 * 2004) — rental income withholding under § 83(1)(b).
 *   - 10% withholding on gross rent paid to a RESIDENT individual landlord.
 *   - 15% withholding on gross rent paid to a NON-RESIDENT landlord
 *     (§ 83(1)(c), Third Schedule ¶4).
 *   - Corporate / juristic landlords fold rent into chargeable income at
 *     30% — withholding still runs at 10% as a prepayment credit.
 *
 * Public refs:
 *   - https://www.tra.go.tz/images/uploads/LAWS/ITA-2004.pdf
 *   - https://www.tra.go.tz/ (Tax Portal — WHT on Rent)
 *
 * ============================================================================
 * LEASE LAW — Land & Tenancy
 * ============================================================================
 *   - Land Act, 1999 (Cap. 113) — general land tenure.
 *   - Land (Landlord and Tenant) Act, 2022 — codifies notice windows,
 *     deposit caps, and Housing Tribunal arbitration for residential
 *     tenancies. See §§ 29–32, 56, 88–90.
 *   - Business Tenancies: 3-month notice standard for termination absent
 *     written clause.
 *
 * Typical norms (confirmed with Tanzanian counsel before production use):
 *   - Residential deposit cap: 6 months (industry norm; no statutory cap
 *     absent specific rent-control area — § 32 LLTA 2022).
 *   - Commercial deposit: 12 months norm.
 *   - Notice for non-payment: 30 days.
 *   - Notice end-of-term: 90 days residential, 3 months commercial.
 *   - Landlord repossession for major refurb: 180 days.
 *
 * ============================================================================
 * DATA PROTECTION
 * ============================================================================
 *   - Personal Data Protection Act, 2022 (Act No. 11 of 2022) + Personal
 *     Data Protection (Personal Data Collection and Processing) Regulations,
 *     2023. Grants GDPR-style access / erasure / rectification rights.
 *     The platform's global right-to-be-forgotten handler satisfies this;
 *     this plugin emits `country: 'TZ'` on every audit event so the Data
 *     Controller can prove per-tenant compliance.
 *
 * ============================================================================
 * IDENTITY
 * ============================================================================
 *   - NIDA: 20-digit National ID issued by the National Identification
 *     Authority (Cap. 2002, Act No. 1 of 1986 as amended). Format:
 *     YYYYMMDD-NNNNN-NNNNN-NN (hyphenated or 20 contiguous digits).
 *   - TIN: 9-digit Taxpayer Identification Number issued by TRA.
 *
 * ============================================================================
 * PHONE
 * ============================================================================
 *   - E.164 +255. Valid mobile network prefixes (post-TCRA 2024 renumbering):
 *     65, 67, 68, 69 (Airtel), 71, 74, 75, 76 (Vodacom), 77, 78 (Tigo),
 *     62 (Halotel), 73 (TTCL). Trunk prefix '0' dropped.
 */

import { buildPhoneNormalizer } from '../../core/phone.js';
import type { CountryPlugin } from '../../core/types.js';
import {
  buildLeaseLawPort,
  buildPaymentRailsPort,
  buildStubScreeningPort,
} from '../_shared.js';
import {
  flatRateWithholding,
  type TaxRegimePort,
} from '../../ports/tax-regime.port.js';
import {
  buildGenericCsvPayload,
  type TaxFilingPort,
  formatFilingPeriodLabel,
} from '../../ports/tax-filing.port.js';
import type { ExtendedCountryProfile, NationalIdValidator } from '../types.js';

// ---------------------------------------------------------------------------
// NIDA validator — 20 digits, hyphens allowed as separators.
// ---------------------------------------------------------------------------

const NIDA_PATTERN = /^\d{20}$/;
const NIDA_HYPHENATED_PATTERN = /^\d{8}-\d{5}-\d{5}-\d{2}$/;

const nidaValidator: NationalIdValidator = {
  id: 'tz-nida',
  label: 'NIDA (National Identification Authority, TZ)',
  validate(raw: string) {
    if (!raw || raw.trim().length === 0) {
      return {
        status: 'invalid',
        ruleId: 'tz-nida',
        note: 'NIDA value is empty.',
        piiSensitive: true,
      };
    }
    const trimmed = raw.trim();
    const digitsOnly = trimmed.replace(/-/g, '');
    if (NIDA_PATTERN.test(digitsOnly) || NIDA_HYPHENATED_PATTERN.test(trimmed)) {
      return {
        status: 'valid',
        ruleId: 'tz-nida',
        piiSensitive: true,
      };
    }
    return {
      status: 'invalid',
      ruleId: 'tz-nida',
      note: 'NIDA must be 20 digits (optionally hyphenated as YYYYMMDD-NNNNN-NNNNN-NN).',
      piiSensitive: true,
    };
  },
};

// ---------------------------------------------------------------------------
// TIN validator — 9 digits, optionally hyphenated 3-3-3.
// ---------------------------------------------------------------------------

const TIN_PATTERN = /^\d{9}$/;
const TIN_HYPHENATED_PATTERN = /^\d{3}-\d{3}-\d{3}$/;

export function validateTraTin(
  raw: string
): { status: 'valid' | 'invalid'; note?: string } {
  if (!raw || raw.trim().length === 0) {
    return { status: 'invalid', note: 'TIN is empty.' };
  }
  const trimmed = raw.trim();
  const digitsOnly = trimmed.replace(/-/g, '');
  if (TIN_PATTERN.test(digitsOnly) || TIN_HYPHENATED_PATTERN.test(trimmed)) {
    return { status: 'valid' };
  }
  return {
    status: 'invalid',
    note: 'TRA TIN must be 9 digits (optionally hyphenated as NNN-NNN-NNN).',
  };
}

// ---------------------------------------------------------------------------
// Phone normalizer — TZ-specific mobile-prefix-aware.
// ---------------------------------------------------------------------------

const TZ_MOBILE_PREFIXES: readonly string[] = Object.freeze([
  '62', '65', '67', '68', '69', '71', '73', '74', '75', '76', '77', '78',
]);

const baseNormalize = buildPhoneNormalizer({
  dialingCode: '255',
  trunkPrefix: '0',
});

/** Tighten the generic E.164 normalizer to reject TZ numbers with an
 * unrecognised mobile prefix. Landlines (022, etc.) pass through. */
function normalizeTzPhone(raw: string): string {
  const e164 = baseNormalize(raw);
  // +2556.../+2557... are mobile ranges; validate the 2-digit prefix.
  if (e164.startsWith('+2556') || e164.startsWith('+2557')) {
    const prefix2 = e164.slice(4, 6);
    if (!TZ_MOBILE_PREFIXES.includes(prefix2)) {
      throw new Error(
        `[TZ] "${raw}" does not match a known TZ mobile prefix (expected one of ${TZ_MOBILE_PREFIXES.join(', ')})`
      );
    }
  }
  return e164;
}

/** Exposed for test assertions — is this prefix a known TZ mobile network? */
export function isKnownTzMobilePrefix(prefix2Digit: string): boolean {
  return TZ_MOBILE_PREFIXES.includes(prefix2Digit);
}

// ---------------------------------------------------------------------------
// Tax regime — Income Tax Act 2004 § 83(1)(b)/(c).
// ---------------------------------------------------------------------------

/**
 * Compute rental-income withholding for TZ. Respects residency flag so
 * non-resident landlords are billed the higher 15% rate.
 *
 * We expose a FACTORY so the orchestrator can supply the landlord's residency
 * status per-lease. The default-exported port picks 10% (resident-individual
 * default) — the monthly-close orchestrator overrides for non-resident cases
 * by calling `buildTzTaxRegime({ isResident: false })`.
 */
export function buildTzTaxRegime(
  opts: { readonly isResident: boolean } = { isResident: true }
): TaxRegimePort {
  const ratePct = opts.isResident ? 10 : 15;
  const rateNote = opts.isResident
    ? 'TRA withholding — 10% on gross rent (resident individual, Income Tax Act §83(1)(b), Cap. 332).'
    : 'TRA withholding — 15% on gross rent (non-resident, Income Tax Act §83(1)(c) + Third Schedule ¶4).';
  return {
    calculateWithholding(grossRentMinorUnits, _currency, _period) {
      return flatRateWithholding(
        grossRentMinorUnits,
        ratePct,
        'TRA-WHT-RENT',
        rateNote
      );
    },
  };
}

const tanzaniaTaxRegime: TaxRegimePort = buildTzTaxRegime({ isResident: true });

// ---------------------------------------------------------------------------
// Tax filing — TRA Tax Portal WHT-on-Rent format.
//
// TRA currently accepts a CSV upload through the Tax Portal's e-Filing
// section for WHT returns. The format below is TRA-compatible: one row per
// paying tenant per period, with the TIN-identified landlord in the header
// line. When / if TRA publishes an official schema (they are migrating to
// XBRL), switch `filingFormat` to 'xml' and add a real payload builder.
// ---------------------------------------------------------------------------

function buildTraPayload(
  run: { readonly lineItems: readonly { leaseId: string; tenantName: string; propertyReference: string; grossRentMinorUnits: number; withholdingMinorUnits: number; currency: string; paymentDate: string; }[]; totalGrossMinorUnits: number; totalWithholdingMinorUnits: number; runId: string },
  tenantProfile: { readonly legalName: string; readonly taxpayerId: string; readonly countryCode: string }
): string {
  const header = [
    '# TRA WHT-RENT FILING',
    `# Taxpayer: ${tenantProfile.legalName}`,
    `# TIN: ${tenantProfile.taxpayerId}`,
    `# Run: ${run.runId}`,
    `# Total gross (TZS): ${run.totalGrossMinorUnits}`,
    `# Total withheld (TZS): ${run.totalWithholdingMinorUnits}`,
  ].join('\n');
  const csv = buildGenericCsvPayload(run);
  return `${header}\n${csv}`;
}

const tanzaniaTaxFiling: TaxFilingPort = {
  prepareFiling(run, tenantProfile, period) {
    return {
      filingFormat: 'csv',
      payload: buildTraPayload(run, tenantProfile),
      targetRegulator: 'TRA',
      submitEndpointHint: 'https://taxportal.tra.go.tz',
      instructions:
        `Upload the CSV to the TRA Tax Portal (https://taxportal.tra.go.tz) ` +
        `under "Withholding Tax Returns" for period ${formatFilingPeriodLabel(period)}. ` +
        `WHT must be paid and return filed by the 7th of the month following ` +
        `the payment date (Income Tax Act §83(4) read with §90). Keep the ` +
        `acknowledgement receipt for audit.`,
    };
  },
};

// ---------------------------------------------------------------------------
// Core CountryPlugin (same shape as the legacy plugin — kept compatible so
// the registry can swap in-place without breaking CountryPlugin consumers).
// ---------------------------------------------------------------------------

const tanzaniaCore: CountryPlugin = {
  countryCode: 'TZ',
  countryName: 'Tanzania',
  currencyCode: 'TZS',
  currencySymbol: 'TSh',
  phoneCountryCode: '255',
  normalizePhone: normalizeTzPhone,
  taxFiling: tanzaniaTaxFiling,
  kycProviders: [
    {
      id: 'nida',
      name: 'National Identification Authority',
      kind: 'national-id',
      envPrefix: 'NIDA',
      idFormat: /^\d{20}$/,
    },
    {
      id: 'tra',
      name: 'Tanzania Revenue Authority (TIN)',
      kind: 'tax-authority',
      envPrefix: 'TRA',
      idFormat: /^\d{9}$/,
    },
    {
      id: 'crb-tz',
      name: 'Credit Reference Bureau (TZ)',
      kind: 'credit-bureau',
      envPrefix: 'CRB_TZ',
    },
    {
      id: 'brela',
      name: 'Business Registrations and Licensing Agency',
      kind: 'business-registry',
      envPrefix: 'BRELA',
    },
  ],
  paymentGateways: [
    { id: 'mpesa_tz', name: 'M-Pesa (Vodacom TZ)', kind: 'mobile-money', envPrefix: 'MPESA_TZ' },
    { id: 'tigopesa', name: 'Tigo Pesa', kind: 'mobile-money', envPrefix: 'TIGOPESA' },
    { id: 'airtelmoney_tz', name: 'Airtel Money (TZ)', kind: 'mobile-money', envPrefix: 'AIRTELMONEY_TZ' },
    { id: 'halopesa', name: 'HaloPesa (Halotel)', kind: 'mobile-money', envPrefix: 'HALOPESA' },
    { id: 'gepg', name: 'Government Electronic Payment Gateway', kind: 'government-portal', envPrefix: 'GEPG' },
    { id: 'tz_bank_transfer', name: 'Bank transfer (TZ)', kind: 'bank-rail', envPrefix: 'TZ_BANK' },
    { id: 'stripe', name: 'Stripe', kind: 'card', envPrefix: 'STRIPE' },
  ],
  compliance: {
    minDepositMonths: 1,
    // Residential norm is 1–3 months; commercial climbs to 6–12. We set the
    // ceiling at 6 so auto-onboarding flags anything above that for review.
    maxDepositMonths: 6,
    noticePeriodDays: 90, // residential end-of-term norm (LLTA 2022 § 56)
    minimumLeaseMonths: 6,
    subleaseConsent: 'consent-required',
    lateFeeCapRate: null, // no statutory cap; arbitrated by Housing Tribunal
    depositReturnDays: 30,
  },
  documentTemplates: [
    {
      id: 'lease-agreement',
      name: 'Mkataba wa Upangaji (TZ Residential Lease)',
      templatePath: 'tz/lease-agreement.hbs',
      locale: 'sw-TZ',
    },
    {
      id: 'notice-of-termination',
      name: 'Notisi ya Kusitisha (TZ Notice of Termination)',
      templatePath: 'tz/notice-of-termination.hbs',
      locale: 'sw-TZ',
    },
    {
      id: 'receipt',
      name: 'Risiti ya Malipo (TZ Payment Receipt)',
      templatePath: 'tz/receipt.hbs',
      locale: 'sw-TZ',
    },
  ],
};

// ---------------------------------------------------------------------------
// Extended profile — joins the 13-country extended registry.
// ---------------------------------------------------------------------------

export const tanzaniaProfile: ExtendedCountryProfile = {
  plugin: tanzaniaCore,
  languages: ['sw', 'en'],
  dateFormat: 'DD/MM/YYYY',
  // TZS is a 0-decimal currency — the minor unit IS the main unit.
  // Intl.NumberFormat renders 50000 as "TSh 50,000" under sw-TZ / en-TZ.
  minorUnitDivisor: 1,
  nationalIdValidator: nidaValidator,
  taxRegime: tanzaniaTaxRegime,
  paymentRails: buildPaymentRailsPort([
    {
      id: 'mpesa_tz',
      label: 'M-Pesa (Vodacom TZ)',
      kind: 'mobile-money',
      currency: 'TZS',
      minAmountMinorUnits: 500,
      settlementLagHours: 2,
      integrationAdapterHint: 'MPESA_TZ',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'tigopesa',
      label: 'Tigo Pesa',
      kind: 'mobile-money',
      currency: 'TZS',
      minAmountMinorUnits: 500,
      settlementLagHours: 2,
      integrationAdapterHint: 'TIGOPESA',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'airtelmoney_tz',
      label: 'Airtel Money (TZ)',
      kind: 'mobile-money',
      currency: 'TZS',
      minAmountMinorUnits: 500,
      settlementLagHours: 4,
      integrationAdapterHint: 'AIRTELMONEY_TZ',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'halopesa',
      label: 'HaloPesa (Halotel)',
      kind: 'mobile-money',
      currency: 'TZS',
      minAmountMinorUnits: 500,
      settlementLagHours: 4,
      integrationAdapterHint: 'HALOPESA',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'gepg',
      label: 'GEPG (Gov Electronic Payment Gateway)',
      kind: 'government-portal',
      currency: 'TZS',
      minAmountMinorUnits: 1000,
      settlementLagHours: 24,
      integrationAdapterHint: 'GEPG',
      supportsCollection: true,
      supportsDisbursement: false,
    },
    {
      id: 'tz_bank_transfer',
      label: 'Bank transfer (TZS)',
      kind: 'bank-transfer',
      currency: 'TZS',
      minAmountMinorUnits: 1000,
      settlementLagHours: 24,
      integrationAdapterHint: 'TZ_BANK',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'stripe',
      label: 'Stripe (card)',
      kind: 'card',
      currency: 'TZS',
      minAmountMinorUnits: 500,
      settlementLagHours: 48,
      integrationAdapterHint: 'STRIPE',
      supportsCollection: true,
      supportsDisbursement: false,
    },
  ]),
  leaseLaw: buildLeaseLawPort({
    requiredClauses: [
      {
        id: 'tz-parties',
        label: 'Parties (landlord + tenant, full legal names, addresses)',
        mandatory: true,
        citation: 'Land (Landlord and Tenant) Act, 2022 § 29.',
      },
      {
        id: 'tz-premises',
        label: 'Description of premises (plot, block, district, locality)',
        mandatory: true,
        citation: 'Land (Landlord and Tenant) Act, 2022 § 29(2).',
      },
      {
        id: 'tz-rent',
        label: 'Rent amount and payment frequency, denominated in TZS',
        mandatory: true,
        citation: 'Land (Landlord and Tenant) Act, 2022 § 30.',
      },
      {
        id: 'tz-tra-tin',
        label: 'Landlord\'s TRA TIN disclosure (for withholding)',
        mandatory: true,
        citation: 'Income Tax Act, Cap. 332 § 83(1)(b) — withholding-agent duty.',
      },
      {
        id: 'tz-deposit',
        label: 'Deposit amount and return conditions',
        mandatory: true,
        citation: 'Land (Landlord and Tenant) Act, 2022 § 32.',
      },
      {
        id: 'tz-notice',
        label: 'Notice period and termination grounds',
        mandatory: true,
        citation: 'Land (Landlord and Tenant) Act, 2022 § 56.',
      },
    ],
    noticeWindowDaysByReason: {
      'non-payment': 30,
      'end-of-term': 90,
      'renewal-non-continuation': 90,
      'landlord-repossession': 180,
      'breach-of-covenant': 30,
      'illegal-use': 14,
      nuisance: 14,
    },
    depositCapByRegime: {
      'residential-standard': {
        maxMonthsOfRent: 6,
        citation:
          'Land (Landlord and Tenant) Act, 2022 § 32 — industry norm 1–3 months; ceiling 6 months.',
      },
      commercial: {
        maxMonthsOfRent: 12,
        citation:
          'Commercial norm; Housing Tribunal arbitrates disputes. No statutory cap.',
      },
      'residential-rent-controlled': {
        maxMonthsOfRent: 3,
        citation:
          'Rent Restriction Act (repealed 2005) applies only in specific declared areas; otherwise § 32 LLTA 2022 governs.',
      },
    },
    rentIncreaseCapByRegime: {
      'residential-standard': {
        citation:
          'No statutory cap. Disputes arbitrated by the Housing Tribunal under Land (Landlord and Tenant) Act, 2022 §§ 88–90.',
      },
      commercial: {
        citation: 'Freely negotiated per contract; no statutory cap.',
      },
    },
    defaultNoticeWindowDays: 90,
  }),
  // Tanzania has NO centralized consumer-credit bureau equivalent to CRB-KE.
  // Credit Reference Bureau (TZ) Regulations 2012 exist, but coverage is
  // institutional-loan-focused and no tenant-screening adapter is available.
  // The stub returns `BUREAU_NOT_CONFIGURED` and the operator playbook
  // recommends: employer-letter verification + 6-month bank statement
  // analysis + employment-contract verification.
  tenantScreening: buildStubScreeningPort('CRB_TZ'),
};

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
 * ROYALTY REGIME — Tanzania Revenue Authority (TRA) / Mining Commission
 * ============================================================================
 * Source: Mining Act 2010 (am. 2017) § 87 — mineral royalty on gross market
 * value, collected by TRA on behalf of the Treasury.
 *   - 6% royalty on gross market value of gold and other metallic minerals.
 *   - + 1% clearing/inspection fee on the same value (Finance Act 2019).
 *   - 16% State free-carried interest in large-scale mining companies
 *     (Mining Act 2010 § 10, am. 2017).
 *
 * Public refs:
 *   - https://www.tra.go.tz/ (Tax Portal — Mineral Royalty Returns)
 *   - https://www.madini.go.tz/ (Mining Commission)
 *
 * ============================================================================
 * MINING LAW — Licensing & Tenure
 * ============================================================================
 *   - Mining Act 2010 (am. 2017) — mineral rights, PML / ML / SML licence
 *     tiers, royalties, and the Mining Commission's dispute arbitration.
 *     See §§ 8, 10, 87.
 *   - PML (Primary Mining Licence): citizen-only, 7-year renewable term —
 *     the ASM formalisation tier.
 *   - Industrial offtake/supply: 3-month notice standard for termination
 *     absent written clause.
 *
 * Typical norms (confirmed with Tanzanian counsel before production use):
 *   - Artisanal performance-bond cap: 6 months (industry norm; no statutory
 *     cap absent a cooperative-managed area — Mining (Mineral Rights) Regs).
 *   - Industrial performance-bond: 12 months norm.
 *   - Notice for royalty-default: 30 days.
 *   - Notice on licence-expiry: 90 days artisanal, 3 months industrial.
 *   - State repossession for non-compliance: 180 days.
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
  buildMiningLawPort,
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
// Royalty regime — Mining Act 2010 (am. 2017) § 87.
// ---------------------------------------------------------------------------

/**
 * Compute mineral-royalty withholding for TZ. The headline royalty on gross
 * market value of metallic minerals is 6%; a 1% clearing/inspection fee
 * (Finance Act 2019) is collected on the same value at clearance.
 *
 * We expose a FACTORY so the orchestrator can choose whether the 1% clearing
 * fee is bundled per consignment. The default-exported port picks 6% (royalty
 * only) — the monthly-close orchestrator overrides for clearance runs by
 * calling `buildTzTaxRegime({ includesClearingFee: true })` → 7%.
 */
export function buildTzTaxRegime(
  opts: { readonly includesClearingFee: boolean } = { includesClearingFee: false }
): TaxRegimePort {
  const ratePct = opts.includesClearingFee ? 7 : 6;
  const rateNote = opts.includesClearingFee
    ? 'TRA mineral royalty — 6% on gross market value + 1% clearing fee (Mining Act 2010 §87 + Finance Act 2019).'
    : 'TRA mineral royalty — 6% on gross market value of metallic minerals (Mining Act 2010 §87).';
  return {
    calculateWithholding(grossValueMinorUnits, _currency, _period) {
      return flatRateWithholding(
        grossValueMinorUnits,
        ratePct,
        'TRA-ROYALTY',
        rateNote
      );
    },
  };
}

const tanzaniaTaxRegime: TaxRegimePort = buildTzTaxRegime({ includesClearingFee: false });

// ---------------------------------------------------------------------------
// Royalty filing — TRA Tax Portal Mineral-Royalty-Return format.
//
// TRA accepts a CSV upload through the Tax Portal's e-Filing section for
// royalty returns. The format below is TRA-compatible: one row per
// consignment per period, with the TIN-identified operator in the header
// line. When / if TRA publishes an official schema (they are migrating to
// XBRL), switch `filingFormat` to 'xml' and add a real payload builder.
// ---------------------------------------------------------------------------

function buildTraPayload(
  run: { readonly lineItems: readonly { offtakeId: string; counterpartyName: string; siteReference: string; grossValueMinorUnits: number; withholdingMinorUnits: number; currency: string; paymentDate: string; }[]; totalGrossMinorUnits: number; totalWithholdingMinorUnits: number; runId: string },
  operatorProfile: { readonly legalName: string; readonly taxpayerId: string; readonly countryCode: string }
): string {
  const header = [
    '# TRA MINERAL-ROYALTY FILING',
    `# Taxpayer: ${operatorProfile.legalName}`,
    `# TIN: ${operatorProfile.taxpayerId}`,
    `# Run: ${run.runId}`,
    `# Total gross (TZS): ${run.totalGrossMinorUnits}`,
    `# Total withheld (TZS): ${run.totalWithholdingMinorUnits}`,
  ].join('\n');
  const csv = buildGenericCsvPayload(run);
  return `${header}\n${csv}`;
}

const tanzaniaTaxFiling: TaxFilingPort = {
  prepareFiling(run, operatorProfile, period) {
    return {
      filingFormat: 'csv',
      payload: buildTraPayload(run, operatorProfile),
      targetRegulator: 'TRA',
      submitEndpointHint: 'https://taxportal.tra.go.tz',
      instructions:
        `Upload the CSV to the TRA Tax Portal (https://taxportal.tra.go.tz) ` +
        `under "Mineral Royalty Returns" for period ${formatFilingPeriodLabel(period)}. ` +
        `Royalty must be paid and return filed by the 7th of the month following ` +
        `the payment date (Mining Act 2010 §87 read with TRA procedure). Keep the ` +
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
    minBondMonths: 1,
    // Artisanal norm is 1–3 months; industrial climbs to 6–12. We set the
    // ceiling at 6 so auto-onboarding flags anything above that for review.
    maxBondMonths: 6,
    noticePeriodDays: 90, // licence-expiry norm (Mining Act 2010)
    minimumTermMonths: 6,
    subSupplyConsent: 'consent-required',
    lateFeeCapRate: null, // no statutory cap; arbitrated by Mining Commission
    bondReturnDays: 30,
  },
  documentTemplates: [
    {
      id: 'offtake-agreement',
      name: 'Mkataba wa Mauzo ya Madini (TZ Mineral Offtake Agreement)',
      templatePath: 'tz/offtake-agreement.hbs',
      locale: 'sw-TZ',
    },
    {
      id: 'notice-of-suspension',
      name: 'Notisi ya Kusimamisha Leseni (TZ Notice of Licence Suspension)',
      templatePath: 'tz/notice-of-suspension.hbs',
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
  miningLaw: buildMiningLawPort({
    requiredClauses: [
      {
        id: 'tz-parties',
        label: 'Parties (owner + counterparty, full legal names, addresses)',
        mandatory: true,
        citation: 'Mining Act 2010 § 8 — mineral rights.',
      },
      {
        id: 'tz-site',
        label: 'Description of licensed mining area (plot, block, district, locality)',
        mandatory: true,
        citation: 'Mining Act 2010 § 8(2).',
      },
      {
        id: 'tz-royalty',
        label: 'Royalty/payment rate and frequency, denominated in TZS',
        mandatory: true,
        citation: 'Mining Act 2010 § 87 — mineral royalty.',
      },
      {
        id: 'tz-tra-tin',
        label: 'Operator\'s TRA TIN disclosure (for royalty withholding)',
        mandatory: true,
        citation: 'Mining Act 2010 § 87 read with TRA withholding-agent duty.',
      },
      {
        id: 'tz-bond',
        label: 'Performance-bond amount and return conditions',
        mandatory: true,
        citation: 'Mining (Mineral Rights) Regulations 2018.',
      },
      {
        id: 'tz-notice',
        label: 'Notice period and licence-suspension grounds',
        mandatory: true,
        citation: 'Mining Act 2010 — Mining Commission procedure.',
      },
    ],
    noticeWindowDaysByReason: {
      'royalty-default': 30,
      'licence-expiry': 90,
      'renewal-non-continuation': 90,
      'state-repossession': 180,
      'breach-of-condition': 30,
      'illegal-mining': 14,
      'environmental-breach': 14,
    },
    bondCapByRegime: {
      'artisanal-standard': {
        maxMonthsOfRoyalty: 6,
        citation:
          'Mining (Mineral Rights) Regulations 2018 — industry norm 1–3 months; ceiling 6 months.',
      },
      industrial: {
        maxMonthsOfRoyalty: 12,
        citation:
          'Industrial (ML/SML) norm; Mining Commission arbitrates disputes. No statutory cap.',
      },
      'artisanal-controlled': {
        maxMonthsOfRoyalty: 3,
        citation:
          'Cooperative-managed PML areas; otherwise the Mining (Mineral Rights) Regulations 2018 govern.',
      },
    },
    royaltyEscalationCapByRegime: {
      'artisanal-standard': {
        citation:
          'No statutory cap. Disputes arbitrated by the Mining Commission under the Mining Act 2010.',
      },
      industrial: {
        citation: 'Freely negotiated per offtake contract; no statutory cap.',
      },
    },
    defaultNoticeWindowDays: 90,
  }),
  // Tanzania has NO centralized consumer-credit bureau equivalent to CRB-KE.
  // Credit Reference Bureau (TZ) Regulations 2012 exist, but coverage is
  // institutional-loan-focused and no counterparty-screening adapter is
  // available. The stub returns `BUREAU_NOT_CONFIGURED` and the operator
  // playbook recommends: bank-reference verification + 6-month statement
  // analysis + LBMA/refiner accreditation checks for off-takers.
  counterpartyScreening: buildStubScreeningPort('CRB_TZ'),
};

/**
 * United Kingdom (GB) — HMRC Non-Resident Landlord Scheme.
 *
 * Source: Income Tax Act 2007 Part 11 & Finance Act 1995 § 42 —
 * letting agents / tenants must withhold 20% basic-rate tax on rent paid
 * to a non-resident landlord unless the landlord holds HMRC approval.
 *
 * Deposit law: Housing Act 2004 Part 6 mandates deposit protection in an
 * authorised scheme within 30 days (TDP / DPS / MyDeposits).
 */

import { buildPhoneNormalizer } from '../../core/phone.js';
import type { CountryPlugin } from '../../core/types.js';
import {
  buildFlatWithholding,
  buildLeaseLawPort,
  buildPaymentRailsPort,
  buildStubScreeningPort,
} from '../_shared.js';
import type { ExtendedCountryProfile } from '../types.js';
import { buildRegexIdValidator } from '../types.js';

const ukCore: CountryPlugin = {
  countryCode: 'GB',
  countryName: 'United Kingdom',
  currencyCode: 'GBP',
  currencySymbol: '£',
  phoneCountryCode: '44',
  normalizePhone: buildPhoneNormalizer({ dialingCode: '44', trunkPrefix: '0' }),
  kycProviders: [
    {
      id: 'nino',
      name: 'National Insurance Number',
      kind: 'national-id',
      envPrefix: 'GB_NINO',
      idFormat: /^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/i,
    },
    {
      id: 'hmrc',
      name: 'HM Revenue & Customs',
      kind: 'tax-authority',
      envPrefix: 'HMRC',
    },
    {
      id: 'experian_gb',
      name: 'Experian UK',
      kind: 'credit-bureau',
      envPrefix: 'EXPERIAN_GB',
    },
    {
      id: 'companies_house',
      name: 'Companies House',
      kind: 'business-registry',
      envPrefix: 'COMPANIES_HOUSE',
    },
  ],
  paymentGateways: [
    {
      id: 'open_banking_gb',
      name: 'UK Open Banking (FPS)',
      kind: 'bank-rail',
      envPrefix: 'OPEN_BANKING_GB',
    },
    { id: 'bacs', name: 'BACS Direct Debit', kind: 'bank-rail', envPrefix: 'BACS' },
    { id: 'stripe', name: 'Stripe', kind: 'card', envPrefix: 'STRIPE' },
  ],
  compliance: {
    minDepositMonths: 0,
    maxDepositMonths: 5, // Tenant Fees Act 2019: 5 weeks < £50k annual rent
    noticePeriodDays: 60,
    minimumLeaseMonths: 6,
    subleaseConsent: 'consent-required',
    lateFeeCapRate: null,
    depositReturnDays: 10,
  },
  documentTemplates: [
    {
      id: 'lease-agreement',
      name: 'Assured Shorthold Tenancy Agreement (GB)',
      templatePath: 'gb/ast-agreement.hbs',
      locale: 'en-GB',
    },
  ],
};

export const ukProfile: ExtendedCountryProfile = {
  plugin: ukCore,
  languages: ['en'],
  dateFormat: 'DD/MM/YYYY',
  minorUnitDivisor: 100,
  nationalIdValidator: buildRegexIdValidator({
    id: 'gb-nino',
    label: 'National Insurance Number',
    pattern: /^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/i,
    piiSensitive: true,
  }),
  taxRegime: buildFlatWithholding(
    20,
    'GB-HMRC-NRLS',
    'Non-Resident Landlord Scheme: 20% basic-rate withholding on rent paid to a non-resident landlord (ITA 2007 Part 11).'
  ),
  paymentRails: buildPaymentRailsPort([
    {
      id: 'open_banking_gb',
      label: 'Open Banking (Faster Payments)',
      kind: 'open-banking',
      currency: 'GBP',
      minAmountMinorUnits: 1,
      settlementLagHours: 2,
      integrationAdapterHint: 'OPEN_BANKING_GB',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'bacs',
      label: 'BACS Direct Debit',
      kind: 'bank-transfer',
      currency: 'GBP',
      minAmountMinorUnits: 1,
      settlementLagHours: 72,
      integrationAdapterHint: 'BACS',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'stripe',
      label: 'Stripe (Card)',
      kind: 'card',
      currency: 'GBP',
      minAmountMinorUnits: 30,
      settlementLagHours: 48,
      integrationAdapterHint: 'STRIPE',
      supportsCollection: true,
      supportsDisbursement: false,
    },
  ]),
  leaseLaw: buildLeaseLawPort({
    requiredClauses: [
      {
        id: 'gb-deposit-scheme',
        label: 'Deposit must sit in authorised TDP / DPS / MyDeposits scheme',
        mandatory: true,
        citation: 'Housing Act 2004 Part 6',
      },
      {
        id: 'gb-section-21-grounds',
        label: 'Notice grounds (Section 21 or Section 8 Housing Act 1988)',
        mandatory: true,
        citation: 'Housing Act 1988 §§ 8, 21',
      },
    ],
    noticeWindowDaysByReason: {
      'end-of-term': 60, // Section 21 — 2 months
      'renewal-non-continuation': 60,
      'non-payment': 14, // Section 8 Ground 8 — 14 days
      'breach-of-covenant': 14,
    },
    depositCapByRegime: {
      'residential-standard': {
        maxWeeksOfRent: 5,
        citation: 'Tenant Fees Act 2019 (annual rent < £50k → 5 weeks cap)',
      },
    },
    rentIncreaseCapByRegime: {
      'residential-standard': {
        citation:
          'No statutory cap on AST rent increases — Section 13 procedure applies on periodic tenancies.',
      },
    },
    defaultNoticeWindowDays: 60,
  }),
  tenantScreening: buildStubScreeningPort('EXPERIAN_GB'),
};

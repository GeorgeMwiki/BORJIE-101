/**
 * United Kingdom (GB) — HMRC withholding on non-resident mineral proceeds.
 *
 * Source: Income Tax Act 2007 Part 11 & Finance Act 1995 § 42 —
 * UK payers must withhold 20% basic-rate tax on proceeds paid to a
 * non-resident operator unless the operator holds HMRC approval.
 *
 * Mining law: Mines (Working Facilities and Support) Act 1966 + the Crown
 * Estate / Coal Authority licensing regime govern mineral rights and the
 * performance bonds required of operators.
 */

import { buildPhoneNormalizer } from '../../core/phone.js';
import type { CountryPlugin } from '../../core/types.js';
import {
  buildFlatWithholding,
  buildMiningLawPort,
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
    minBondMonths: 0,
    maxBondMonths: 5, // performance-bond norm ≈ 5 weeks royalty
    noticePeriodDays: 60,
    minimumTermMonths: 6,
    subSupplyConsent: 'consent-required',
    lateFeeCapRate: null,
    bondReturnDays: 10,
  },
  documentTemplates: [
    {
      id: 'offtake-agreement',
      name: 'Mineral Offtake & Supply Agreement (GB)',
      templatePath: 'gb/offtake-agreement.hbs',
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
    'GB-HMRC-NR',
    'Non-resident withholding: 20% basic-rate tax on mineral proceeds paid to a non-resident operator (ITA 2007 Part 11).'
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
  miningLaw: buildMiningLawPort({
    requiredClauses: [
      {
        id: 'gb-bond-security',
        label: 'Performance / restoration bond held against operator obligations',
        mandatory: true,
        citation: 'Mines (Working Facilities and Support) Act 1966',
      },
      {
        id: 'gb-notice-grounds',
        label: 'Notice / termination grounds for the offtake or supply agreement',
        mandatory: true,
        citation: 'Coal Industry Act 1994; Crown Estate licence conditions',
      },
    ],
    noticeWindowDaysByReason: {
      'licence-expiry': 60, // 2 months
      'renewal-non-continuation': 60,
      'royalty-default': 14, // 14-day cure
      'breach-of-condition': 14,
    },
    bondCapByRegime: {
      'artisanal-standard': {
        maxWeeksOfRoyalty: 5,
        citation: 'Performance-bond norm (≈ 5 weeks royalty for small operators)',
      },
    },
    royaltyEscalationCapByRegime: {
      'artisanal-standard': {
        citation:
          'No statutory cap on royalty escalation — review procedure applies per agreement.',
      },
    },
    defaultNoticeWindowDays: 60,
  }),
  counterpartyScreening: buildStubScreeningPort('EXPERIAN_GB'),
};

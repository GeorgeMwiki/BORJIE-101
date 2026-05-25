/**
 * United Arab Emirates (AE) — no personal income tax.
 *
 * Source: UAE Federal Decree-Law No. 47 of 2022 — corporate tax applies
 * from June 2023 but PERSONAL rental income is not subject to income tax.
 * Emirate-level "municipality fees" (5% in Dubai) apply — not plugin scope.
 *
 * Lease: Dubai Rera mandates Ejari registration; RERA rental-increase
 * calculator caps increases (0-20% by gap to market).
 */

import { buildPhoneNormalizer } from '../../core/phone.js';
import type { CountryPlugin } from '../../core/types.js';
import {
  buildLeaseLawPort,
  buildPaymentRailsPort,
  buildStubScreeningPort,
  stubWithholding,
} from '../_shared.js';
import type { ExtendedCountryProfile } from '../types.js';
import { buildRegexIdValidator } from '../types.js';

const uaeCore: CountryPlugin = {
  countryCode: 'AE',
  countryName: 'United Arab Emirates',
  currencyCode: 'AED',
  currencySymbol: 'د.إ',
  phoneCountryCode: '971',
  normalizePhone: buildPhoneNormalizer({ dialingCode: '971', trunkPrefix: '0' }),
  kycProviders: [
    {
      id: 'emirates_id',
      name: 'Emirates ID',
      kind: 'national-id',
      envPrefix: 'EMIRATES_ID',
      idFormat: /^784-?\d{4}-?\d{7}-?\d$/,
    },
    {
      id: 'fta_ae',
      name: 'Federal Tax Authority (FTA)',
      kind: 'tax-authority',
      envPrefix: 'FTA_AE',
    },
    {
      id: 'aecb',
      name: 'Al Etihad Credit Bureau',
      kind: 'credit-bureau',
      envPrefix: 'AECB',
    },
    {
      id: 'ded_ae',
      name: 'Department of Economic Development',
      kind: 'business-registry',
      envPrefix: 'DED_AE',
    },
  ],
  paymentGateways: [
    {
      id: 'careem_pay',
      name: 'Careem Pay',
      kind: 'card',
      envPrefix: 'CAREEM_PAY',
    },
    {
      id: 'ae_bank_transfer',
      name: 'Bank transfer (AE)',
      kind: 'bank-rail',
      envPrefix: 'AE_BANK',
    },
    { id: 'stripe', name: 'Stripe', kind: 'card', envPrefix: 'STRIPE' },
  ],
  compliance: {
    minDepositMonths: 1,
    maxDepositMonths: 3,
    noticePeriodDays: 90, // Dubai RERA Law 26/2007 — 12 months notice for non-renewal
    minimumLeaseMonths: 12,
    subleaseConsent: 'consent-required',
    lateFeeCapRate: null,
    depositReturnDays: 30,
  },
  documentTemplates: [
    {
      id: 'lease-agreement',
      name: 'Ejari Tenancy Contract (AE)',
      templatePath: 'ae/lease-agreement.hbs',
      locale: 'ar-AE',
    },
  ],
};

export const uaeProfile: ExtendedCountryProfile = {
  plugin: uaeCore,
  languages: ['ar', 'en'],
  dateFormat: 'DD/MM/YYYY',
  minorUnitDivisor: 100,
  nationalIdValidator: buildRegexIdValidator({
    id: 'ae-emirates-id',
    label: 'Emirates ID',
    pattern: /^784-?\d{4}-?\d{7}-?\d$/,
    piiSensitive: true,
  }),
  taxRegime: stubWithholding(
    'AE-FTA-NO-WHT',
    'UAE has no personal income tax on rental income (Federal Decree-Law 47/2022). Corporate tax (9%) may apply to juristic landlords — configure per entity.'
  ),
  paymentRails: buildPaymentRailsPort([
    {
      id: 'ae_bank_transfer',
      label: 'UAE Bank Transfer (IBAN)',
      kind: 'bank-transfer',
      currency: 'AED',
      minAmountMinorUnits: 1,
      settlementLagHours: 4,
      integrationAdapterHint: 'AE_BANK',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'careem_pay',
      label: 'Careem Pay',
      kind: 'wallet',
      currency: 'AED',
      minAmountMinorUnits: 100,
      settlementLagHours: 24,
      integrationAdapterHint: 'CAREEM_PAY',
      supportsCollection: true,
      supportsDisbursement: false,
    },
    {
      id: 'stripe',
      label: 'Stripe (Card)',
      kind: 'card',
      currency: 'AED',
      minAmountMinorUnits: 50,
      settlementLagHours: 48,
      integrationAdapterHint: 'STRIPE',
      supportsCollection: true,
      supportsDisbursement: false,
    },
  ]),
  leaseLaw: buildLeaseLawPort({
    requiredClauses: [
      {
        id: 'ae-ejari',
        label: 'Contract must be registered via Ejari (Dubai RERA)',
        mandatory: true,
        citation: 'Dubai Law 26 of 2007',
      },
    ],
    noticeWindowDaysByReason: {
      'end-of-term': 360, // 12 months notice for non-renewal
      'non-payment': 30,
    },
    depositCapByRegime: {
      'residential-standard': {
        citation: 'No statutory cap; industry norm 5-10% of annual rent.',
      },
    },
    rentIncreaseCapByRegime: {
      'residential-standard': {
        indexedTo: 'LOCAL_INDEX',
        citation: 'RERA Rental Increase Calculator (Decree 43/2013).',
      },
    },
    defaultNoticeWindowDays: 90,
  }),
  tenantScreening: buildStubScreeningPort('AECB_AE'),
};

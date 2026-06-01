/**
 * United Arab Emirates (AE) — no personal income tax; gold-trade hub.
 *
 * Source: UAE Federal Decree-Law No. 47 of 2022 — corporate tax applies
 * from June 2023 but PERSONAL mineral-trade income is not subject to income
 * tax. The UAE (DMCC / Dubai Good Delivery) is a major precious-metals
 * refining and offtake hub rather than a producer.
 *
 * Offtake: DMCC mandates registration of bullion dealers; OECD due-diligence
 * and Dubai Good Delivery standards govern responsible sourcing.
 */

import { buildPhoneNormalizer } from '../../core/phone.js';
import type { CountryPlugin } from '../../core/types.js';
import {
  buildMiningLawPort,
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
    minBondMonths: 1,
    maxBondMonths: 3,
    noticePeriodDays: 90, // 12-month notice norm for non-renewal of supply
    minimumTermMonths: 12,
    subSupplyConsent: 'consent-required',
    lateFeeCapRate: null,
    bondReturnDays: 30,
  },
  documentTemplates: [
    {
      id: 'offtake-agreement',
      name: 'DMCC Bullion Offtake Contract (AE)',
      templatePath: 'ae/offtake-agreement.hbs',
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
    'UAE has no personal income tax on mineral-trade income (Federal Decree-Law 47/2022). Corporate tax (9%) may apply to juristic operators — configure per entity.'
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
  miningLaw: buildMiningLawPort({
    requiredClauses: [
      {
        id: 'ae-dmcc',
        label: 'Bullion dealer registered with DMCC; OECD due-diligence attached',
        mandatory: true,
        citation: 'DMCC Rules; OECD Due Diligence Guidance',
      },
    ],
    noticeWindowDaysByReason: {
      'licence-expiry': 360, // 12 months notice for non-renewal
      'royalty-default': 30,
    },
    bondCapByRegime: {
      'artisanal-standard': {
        citation: 'No statutory cap; industry norm 5-10% of annual contract value.',
      },
    },
    royaltyEscalationCapByRegime: {
      'artisanal-standard': {
        indexedTo: 'LOCAL_INDEX',
        citation: 'LBMA / Dubai Good Delivery price indexation.',
      },
    },
    defaultNoticeWindowDays: 90,
  }),
  counterpartyScreening: buildStubScreeningPort('AECB_AE'),
};

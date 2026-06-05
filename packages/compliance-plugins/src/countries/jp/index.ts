/**
 * Japan (JP) — 20.42% withholding on non-resident mineral proceeds.
 *
 * Source: Income Tax Act § 212 — 20% on gross proceeds paid to non-resident
 * operators + 2.1% reconstruction surtax (special income tax for
 * reconstruction) → blended 20.42%. Mining tenure is governed by the
 * Mining Act (鉱業法, Kōgyōhō).
 * JPY is zero-decimal — minor units divisor is 1.
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

const japanCore: CountryPlugin = {
  countryCode: 'JP',
  countryName: 'Japan',
  currencyCode: 'JPY',
  currencySymbol: '¥',
  phoneCountryCode: '81',
  normalizePhone: buildPhoneNormalizer({ dialingCode: '81', trunkPrefix: '0' }),
  kycProviders: [
    {
      id: 'my_number',
      name: 'My Number (個人番号)',
      kind: 'national-id',
      envPrefix: 'JP_MY_NUMBER',
      idFormat: /^\d{12}$/,
    },
    {
      id: 'nta_jp',
      name: 'National Tax Agency (国税庁)',
      kind: 'tax-authority',
      envPrefix: 'NTA_JP',
    },
    {
      id: 'cic_jp',
      name: 'CIC (Credit Information Center)',
      kind: 'credit-bureau',
      envPrefix: 'CIC_JP',
    },
  ],
  paymentGateways: [
    { id: 'paypay', name: 'PayPay', kind: 'card', envPrefix: 'PAYPAY' },
    {
      id: 'jp_bank_transfer',
      name: 'Bank transfer (振込)',
      kind: 'bank-rail',
      envPrefix: 'JP_BANK',
    },
    { id: 'stripe', name: 'Stripe', kind: 'card', envPrefix: 'STRIPE' },
  ],
  compliance: {
    minBondMonths: 1,
    maxBondMonths: 6, // shikikin + reikin can be 1-6 months combined
    noticePeriodDays: 180,
    minimumTermMonths: 24,
    subSupplyConsent: 'consent-required',
    lateFeeCapRate: null,
    bondReturnDays: 30,
  },
  documentTemplates: [
    {
      id: 'offtake-agreement',
      name: '鉱物供給契約書 (JP Mineral Offtake)',
      templatePath: 'jp/offtake-agreement.hbs',
      locale: 'ja-JP',
    },
  ],
};

export const japanProfile: ExtendedCountryProfile = {
  plugin: japanCore,
  languages: ['ja', 'en'],
  dateFormat: 'YYYY/MM/DD',
  minorUnitDivisor: 1, // JPY has no subdivisions
  nationalIdValidator: buildRegexIdValidator({
    id: 'jp-my-number',
    label: 'My Number',
    pattern: /^\d{12}$/,
    piiSensitive: true,
    failureNote:
      'My Number must be exactly 12 digits. APPI § 17 — tokenize immediately.',
  }),
  taxRegime: buildFlatWithholding(
    20.42,
    'JP-NTA-IT-212',
    'Non-resident withholding: 20% income tax + 2.1% reconstruction surtax = 20.42% on gross mineral proceeds (ITA § 212).'
  ),
  paymentRails: buildPaymentRailsPort([
    {
      id: 'jp_bank_transfer',
      label: 'Bank Transfer (Zengin)',
      kind: 'bank-transfer',
      currency: 'JPY',
      minAmountMinorUnits: 1,
      settlementLagHours: 4,
      integrationAdapterHint: 'JP_BANK',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'paypay',
      label: 'PayPay',
      kind: 'wallet',
      currency: 'JPY',
      minAmountMinorUnits: 1,
      settlementLagHours: 24,
      integrationAdapterHint: 'PAYPAY',
      supportsCollection: true,
      supportsDisbursement: false,
    },
    {
      id: 'stripe',
      label: 'Stripe (Card)',
      kind: 'card',
      currency: 'JPY',
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
        id: 'jp-kogyoho',
        label: 'Mining Act tenure & obligations (鉱業法)',
        mandatory: true,
        citation: 'Mining Act 1950 (鉱業法)',
      },
    ],
    noticeWindowDaysByReason: {
      'licence-expiry': 180,
      'renewal-non-continuation': 180,
      'royalty-default': 30,
    },
    bondCapByRegime: {
      'artisanal-standard': {
        citation:
          'No statutory cap; performance-bond industry practice 1-6 months royalty.',
      },
    },
    royaltyEscalationCapByRegime: {
      'artisanal-standard': {
        citation:
          'Royalty adjustment by agreement or court under the Mining Act.',
      },
    },
    defaultNoticeWindowDays: 180,
  }),
  counterpartyScreening: buildStubScreeningPort('CIC_JP'),
};

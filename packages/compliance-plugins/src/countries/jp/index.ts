/**
 * Japan (JP) — 20.42% withholding on non-resident rental income.
 *
 * Source: Income Tax Act § 212 — 20% on gross rent paid to non-resident
 * landlords + 2.1% reconstruction surtax (special income tax for
 * reconstruction) → blended 20.42%.
 * JPY is zero-decimal — minor units divisor is 1.
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
    minDepositMonths: 1,
    maxDepositMonths: 6, // shikikin + reikin can be 1-6 months combined
    noticePeriodDays: 180,
    minimumLeaseMonths: 24,
    subleaseConsent: 'consent-required',
    lateFeeCapRate: null,
    depositReturnDays: 30,
  },
  documentTemplates: [
    {
      id: 'lease-agreement',
      name: '賃貸借契約書 (JP)',
      templatePath: 'jp/lease-agreement.hbs',
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
    'Non-resident rental withholding: 20% income tax + 2.1% reconstruction surtax = 20.42% on gross rent (ITA § 212).'
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
  leaseLaw: buildLeaseLawPort({
    requiredClauses: [
      {
        id: 'jp-shakuchi-shakuya',
        label: 'Land & House Lease Act protections (借地借家法)',
        mandatory: true,
        citation: 'Land and House Lease Act 1991',
      },
    ],
    noticeWindowDaysByReason: {
      'end-of-term': 180,
      'renewal-non-continuation': 180,
      'non-payment': 30,
    },
    depositCapByRegime: {
      'residential-standard': {
        citation:
          'No statutory cap; shikikin + reikin industry practice 1-6 months.',
      },
    },
    rentIncreaseCapByRegime: {
      'residential-standard': {
        citation:
          'Land & House Lease Act § 32 — rent adjustment by agreement or court.',
      },
    },
    defaultNoticeWindowDays: 180,
  }),
  tenantScreening: buildStubScreeningPort('CIC_JP'),
};

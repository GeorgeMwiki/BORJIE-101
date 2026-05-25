/**
 * South Korea (KR) — 20.42% withholding on non-resident rental income
 * (20% domestic + 2% local income tax surtax). Resident landlords file
 * comprehensive income tax (종합소득세) instead — defer to operator config.
 *
 * Sources:
 *  - Income Tax Act Art. 156 / Presidential Decree Art. 207
 *  - Housing Lease Protection Act (주택임대차보호법)
 *
 * NOTE: RRN (resident registration number) is HIGHLY sensitive under
 * Korea's Personal Information Protection Act (PIPA). Validator flags
 * this explicitly — consumers MUST tokenize before storage.
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

const koreaCore: CountryPlugin = {
  countryCode: 'KR',
  countryName: 'South Korea',
  currencyCode: 'KRW',
  currencySymbol: '₩',
  phoneCountryCode: '82',
  normalizePhone: buildPhoneNormalizer({ dialingCode: '82', trunkPrefix: '0' }),
  kycProviders: [
    {
      id: 'rrn',
      name: 'Resident Registration Number (주민등록번호)',
      kind: 'national-id',
      envPrefix: 'KR_RRN',
      idFormat: /^\d{6}-?\d{7}$/,
    },
    {
      id: 'nice-kr',
      name: 'NICE Information Service',
      kind: 'credit-bureau',
      envPrefix: 'NICE_KR',
    },
    {
      id: 'nts-kr',
      name: 'National Tax Service (국세청)',
      kind: 'tax-authority',
      envPrefix: 'NTS_KR',
    },
  ],
  paymentGateways: [
    { id: 'toss', name: 'Toss Payments', kind: 'card', envPrefix: 'TOSS' },
    { id: 'kakaopay', name: 'KakaoPay', kind: 'card', envPrefix: 'KAKAOPAY' },
    { id: 'stripe', name: 'Stripe', kind: 'card', envPrefix: 'STRIPE' },
  ],
  compliance: {
    minDepositMonths: 0,
    maxDepositMonths: 24, // jeonse deposits can be enormous — no statutory cap
    noticePeriodDays: 60,
    minimumLeaseMonths: 24, // HLPA guarantees 2-year minimum on residential
    subleaseConsent: 'consent-required',
    lateFeeCapRate: null,
    depositReturnDays: 30,
  },
  documentTemplates: [
    {
      id: 'lease-agreement',
      name: '주택임대차계약서 (KR)',
      templatePath: 'kr/lease-agreement.hbs',
      locale: 'ko-KR',
    },
  ],
};

export const koreaProfile: ExtendedCountryProfile = {
  plugin: koreaCore,
  languages: ['ko', 'en'],
  dateFormat: 'YYYY-MM-DD',
  minorUnitDivisor: 1, // KRW has no subdivisions
  nationalIdValidator: buildRegexIdValidator({
    id: 'kr-rrn',
    label: 'Resident Registration Number',
    pattern: /^\d{6}-?\d{7}$/,
    piiSensitive: true,
    failureNote:
      'RRN must be 13 digits (6-7 format). Tokenize immediately — PIPA Art. 24.',
  }),
  taxRegime: buildFlatWithholding(
    20.42,
    'KR-NTS-ITA-156',
    'Non-resident rental withholding: 20% income tax + 2% local surtax (Income Tax Act Art. 156).'
  ),
  paymentRails: buildPaymentRailsPort([
    {
      id: 'toss',
      label: 'Toss Payments',
      kind: 'wallet',
      currency: 'KRW',
      minAmountMinorUnits: 100,
      settlementLagHours: 24,
      integrationAdapterHint: 'TOSS',
      supportsCollection: true,
      supportsDisbursement: false,
    },
    {
      id: 'kakaopay',
      label: 'KakaoPay',
      kind: 'wallet',
      currency: 'KRW',
      minAmountMinorUnits: 100,
      settlementLagHours: 24,
      integrationAdapterHint: 'KAKAOPAY',
      supportsCollection: true,
      supportsDisbursement: false,
    },
    {
      id: 'kr_bank_transfer',
      label: 'Korean Bank Transfer (계좌이체)',
      kind: 'bank-transfer',
      currency: 'KRW',
      minAmountMinorUnits: 1,
      settlementLagHours: 4,
      integrationAdapterHint: null,
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'stripe',
      label: 'Stripe (Card)',
      kind: 'card',
      currency: 'KRW',
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
        id: 'kr-term',
        label: 'Minimum 2-year term (주택임대차보호법 제4조)',
        mandatory: true,
        citation: 'Housing Lease Protection Act Art. 4',
      },
      {
        id: 'kr-deposit',
        label: 'Deposit (보증금 / 전세금) and return conditions',
        mandatory: true,
        citation: 'Housing Lease Protection Act Art. 3-3',
      },
    ],
    noticeWindowDaysByReason: {
      'end-of-term': 60,
      'renewal-non-continuation': 60,
      'non-payment': 30,
    },
    depositCapByRegime: {
      'residential-standard': {
        citation:
          'No statutory cap — jeonse deposits commonly exceed 70% of property value.',
      },
    },
    rentIncreaseCapByRegime: {
      'residential-standard': {
        pctPerAnnum: 5,
        citation: 'Housing Lease Protection Act Enforcement Decree Art. 8 (5% cap on renewal)',
      },
    },
    defaultNoticeWindowDays: 60,
  }),
  tenantScreening: buildStubScreeningPort('NICE_KR'),
};

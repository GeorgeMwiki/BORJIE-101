/**
 * India (IN) — TDS under § 194-I / § 194-O of the Income-tax Act 1961 plus
 * mineral royalties under the MMDR Act 1957.
 *
 * Source: CBDT circulars — 10% TDS applies to specified mineral-supply
 * payments; the MMDR Act 1957 Second Schedule sets ad-valorem royalty rates
 * collected by the states. Plugin uses 10% withholding default; callers
 * override per mineral / state royalty schedule.
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

const indiaCore: CountryPlugin = {
  countryCode: 'IN',
  countryName: 'India',
  currencyCode: 'INR',
  currencySymbol: '₹',
  phoneCountryCode: '91',
  normalizePhone: buildPhoneNormalizer({ dialingCode: '91', trunkPrefix: '0' }),
  kycProviders: [
    {
      id: 'aadhaar',
      name: 'Aadhaar (UIDAI)',
      kind: 'national-id',
      envPrefix: 'AADHAAR',
      idFormat: /^\d{4}-?\d{4}-?\d{4}$/,
    },
    {
      id: 'pan',
      name: 'Permanent Account Number',
      kind: 'tax-authority',
      envPrefix: 'PAN',
      idFormat: /^[A-Z]{5}\d{4}[A-Z]$/,
    },
    {
      id: 'cibil',
      name: 'TransUnion CIBIL',
      kind: 'credit-bureau',
      envPrefix: 'CIBIL',
    },
    {
      id: 'mca_in',
      name: 'Ministry of Corporate Affairs',
      kind: 'business-registry',
      envPrefix: 'MCA_IN',
    },
  ],
  paymentGateways: [
    { id: 'upi', name: 'UPI', kind: 'bank-rail', envPrefix: 'UPI' },
    { id: 'imps', name: 'IMPS', kind: 'bank-rail', envPrefix: 'IMPS' },
    { id: 'neft', name: 'NEFT', kind: 'bank-rail', envPrefix: 'NEFT' },
    { id: 'razorpay', name: 'Razorpay', kind: 'card', envPrefix: 'RAZORPAY' },
  ],
  compliance: {
    minBondMonths: 2, // performance-bond norm ≈ 2 months royalty
    maxBondMonths: 2,
    noticePeriodDays: 60,
    minimumTermMonths: 11,
    subSupplyConsent: 'consent-required',
    lateFeeCapRate: null,
    bondReturnDays: 30,
  },
  documentTemplates: [
    {
      id: 'offtake-agreement',
      name: 'Mineral Offtake Agreement (IN)',
      templatePath: 'in/offtake-agreement.hbs',
      locale: 'en-IN',
    },
  ],
};

export const indiaProfile: ExtendedCountryProfile = {
  plugin: indiaCore,
  languages: ['en', 'hi', 'ta', 'bn', 'te', 'mr'],
  dateFormat: 'DD/MM/YYYY',
  minorUnitDivisor: 100,
  nationalIdValidator: buildRegexIdValidator({
    id: 'in-pan',
    label: 'PAN (Permanent Account Number)',
    pattern: /^[A-Z]{5}\d{4}[A-Z]$/,
  }),
  taxRegime: buildFlatWithholding(
    10,
    'IN-CBDT-IT-194I',
    'TDS on mineral-supply payments — 10% baseline (§ 194-I family). MMDR Act 1957 ad-valorem royalty applies separately per state schedule.'
  ),
  paymentRails: buildPaymentRailsPort([
    {
      id: 'upi',
      label: 'Unified Payments Interface',
      kind: 'bank-transfer',
      currency: 'INR',
      minAmountMinorUnits: 100,
      settlementLagHours: 0,
      integrationAdapterHint: 'UPI',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'imps',
      label: 'Immediate Payment Service',
      kind: 'bank-transfer',
      currency: 'INR',
      minAmountMinorUnits: 100,
      settlementLagHours: 0,
      integrationAdapterHint: 'IMPS',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'neft',
      label: 'NEFT',
      kind: 'bank-transfer',
      currency: 'INR',
      minAmountMinorUnits: 100,
      settlementLagHours: 2,
      integrationAdapterHint: 'NEFT',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'razorpay',
      label: 'Razorpay (Card + Wallet)',
      kind: 'card',
      currency: 'INR',
      minAmountMinorUnits: 100,
      settlementLagHours: 48,
      integrationAdapterHint: 'RAZORPAY',
      supportsCollection: true,
      supportsDisbursement: false,
    },
  ]),
  miningLaw: buildMiningLawPort({
    requiredClauses: [
      {
        id: 'in-stamp-duty',
        label: 'Stamp duty and registration (Registration Act 1908)',
        mandatory: true,
        citation: 'Registration Act 1908 § 17',
      },
      {
        id: 'in-bond-cap',
        label: 'Performance-bond cap — 2 months royalty (artisanal)',
        mandatory: true,
        citation: 'MMDR Act 1957; Mineral Concession Rules.',
      },
    ],
    noticeWindowDaysByReason: {
      'licence-expiry': 60,
      'royalty-default': 30,
    },
    bondCapByRegime: {
      'artisanal-standard': {
        maxMonthsOfRoyalty: 2,
        citation: 'Mineral Concession Rules (artisanal / small-scale).',
      },
      industrial: {
        maxMonthsOfRoyalty: 6,
        citation: 'Mineral Concession Rules (industrial / large-scale).',
      },
    },
    royaltyEscalationCapByRegime: {
      'artisanal-standard': {
        citation: 'Per agreement; MMDR royalty schedule revised periodically by the Centre.',
      },
    },
    defaultNoticeWindowDays: 60,
  }),
  counterpartyScreening: buildStubScreeningPort('CIBIL_IN'),
};

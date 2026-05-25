/**
 * India (IN) — TDS under § 194-I / § 194-IB of the Income-tax Act 1961.
 *
 * Source: CBDT circulars — 10% TDS on rent for land/building above
 * ₹240,000 p.a. paid by a non-individual; § 194-IB applies 5% TDS for
 * individuals / HUFs paying > ₹50,000 / month. Plugin uses 10% default;
 * callers override for § 194-IB cases.
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
    minDepositMonths: 2, // Model Tenancy Act 2021: max 2 for residential
    maxDepositMonths: 2,
    noticePeriodDays: 60,
    minimumLeaseMonths: 11,
    subleaseConsent: 'consent-required',
    lateFeeCapRate: null,
    depositReturnDays: 30,
  },
  documentTemplates: [
    {
      id: 'lease-agreement',
      name: 'Leave & License Agreement (IN)',
      templatePath: 'in/lease-agreement.hbs',
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
    'TDS on rent — 10% on land/building rent where annual rent > ₹2.4 lakh (§ 194-I). Override to 5% for § 194-IB individual payers.'
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
  leaseLaw: buildLeaseLawPort({
    requiredClauses: [
      {
        id: 'in-stamp-duty',
        label: 'Stamp duty and registration (Registration Act 1908)',
        mandatory: true,
        citation: 'Registration Act 1908 § 17',
      },
      {
        id: 'in-deposit-cap',
        label: 'Deposit cap — 2 months residential (Model Tenancy Act 2021)',
        mandatory: true,
        citation: 'Model Tenancy Act 2021 § 11',
      },
    ],
    noticeWindowDaysByReason: {
      'end-of-term': 60,
      'non-payment': 30,
    },
    depositCapByRegime: {
      'residential-standard': {
        maxMonthsOfRent: 2,
        citation: 'Model Tenancy Act 2021 § 11 (residential)',
      },
      commercial: {
        maxMonthsOfRent: 6,
        citation: 'Model Tenancy Act 2021 § 11 (non-residential)',
      },
    },
    rentIncreaseCapByRegime: {
      'residential-standard': {
        citation: 'Per agreement; 3-month notice for revision (MTA § 12).',
      },
    },
    defaultNoticeWindowDays: 60,
  }),
  tenantScreening: buildStubScreeningPort('CIBIL_IN'),
};

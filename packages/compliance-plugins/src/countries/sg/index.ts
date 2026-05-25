/**
 * Singapore (SG) — IRAS withholding on non-resident rental income.
 *
 * Source: Income Tax Act §45C — 15% withholding on gross rent paid to a
 * non-resident property owner (payer liable).
 * Tenancy: no statutory deposit cap; industry norm = 1-3 months.
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

const singaporeCore: CountryPlugin = {
  countryCode: 'SG',
  countryName: 'Singapore',
  currencyCode: 'SGD',
  currencySymbol: 'S$',
  phoneCountryCode: '65',
  normalizePhone: buildPhoneNormalizer({ dialingCode: '65' }),
  kycProviders: [
    {
      id: 'nric',
      name: 'NRIC (National Registration Identity Card)',
      kind: 'national-id',
      envPrefix: 'SG_NRIC',
      idFormat: /^[STFG]\d{7}[A-Z]$/,
    },
    {
      id: 'iras',
      name: 'Inland Revenue Authority of Singapore',
      kind: 'tax-authority',
      envPrefix: 'IRAS',
    },
    {
      id: 'acra',
      name: 'ACRA Bizfile',
      kind: 'business-registry',
      envPrefix: 'ACRA',
    },
  ],
  paymentGateways: [
    { id: 'paynow_sg', name: 'PayNow', kind: 'bank-rail', envPrefix: 'PAYNOW_SG' },
    { id: 'giro_sg', name: 'GIRO', kind: 'bank-rail', envPrefix: 'GIRO_SG' },
    { id: 'stripe', name: 'Stripe', kind: 'card', envPrefix: 'STRIPE' },
  ],
  compliance: {
    minDepositMonths: 1,
    maxDepositMonths: 3,
    noticePeriodDays: 60,
    minimumLeaseMonths: 6,
    subleaseConsent: 'consent-required',
    lateFeeCapRate: null,
    depositReturnDays: 14,
  },
  documentTemplates: [
    {
      id: 'lease-agreement',
      name: 'Tenancy Agreement (SG)',
      templatePath: 'sg/tenancy-agreement.hbs',
      locale: 'en-SG',
    },
  ],
};

export const singaporeProfile: ExtendedCountryProfile = {
  plugin: singaporeCore,
  languages: ['en', 'zh', 'ms', 'ta'],
  dateFormat: 'DD/MM/YYYY',
  minorUnitDivisor: 100,
  nationalIdValidator: buildRegexIdValidator({
    id: 'sg-nric',
    label: 'NRIC',
    pattern: /^[STFG]\d{7}[A-Z]$/,
    piiSensitive: true,
  }),
  taxRegime: buildFlatWithholding(
    15,
    'SG-IRAS-ITA-45C',
    'Non-resident rental withholding: 15% on gross rent (ITA § 45C).'
  ),
  paymentRails: buildPaymentRailsPort([
    {
      id: 'paynow_sg',
      label: 'PayNow (Corporate)',
      kind: 'open-banking',
      currency: 'SGD',
      minAmountMinorUnits: 1,
      settlementLagHours: 1,
      integrationAdapterHint: 'PAYNOW_SG',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'giro_sg',
      label: 'GIRO Direct Debit',
      kind: 'bank-transfer',
      currency: 'SGD',
      minAmountMinorUnits: 1,
      settlementLagHours: 72,
      integrationAdapterHint: 'GIRO_SG',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'stripe',
      label: 'Stripe (Card)',
      kind: 'card',
      currency: 'SGD',
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
        id: 'sg-stamp-duty',
        label: 'Tenancy must be e-stamped with IRAS within 14 days',
        mandatory: true,
        citation: 'Stamp Duties Act § 22',
      },
    ],
    noticeWindowDaysByReason: {
      'end-of-term': 60,
      'non-payment': 14,
    },
    depositCapByRegime: {
      'residential-standard': {
        citation: 'No statutory cap; industry norm 1-3 months.',
      },
    },
    rentIncreaseCapByRegime: {
      'residential-standard': {
        citation: 'No statutory rent control.',
      },
    },
    defaultNoticeWindowDays: 60,
  }),
  tenantScreening: buildStubScreeningPort('CBS_SG'),
};

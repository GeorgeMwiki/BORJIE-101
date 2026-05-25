/**
 * Australia (AU) — ATO foreign-resident rental withholding.
 *
 * Source: ITAA 1936 § 128B — 10% final withholding on interest-like rent
 * structures (not typical rent); ordinary rent is assessed through tax
 * return, NOT withheld. This plugin flags the area as operator-configurable
 * so landlord-tenant consumers don't auto-withhold incorrectly.
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

const australiaCore: CountryPlugin = {
  countryCode: 'AU',
  countryName: 'Australia',
  currencyCode: 'AUD',
  currencySymbol: 'A$',
  phoneCountryCode: '61',
  normalizePhone: buildPhoneNormalizer({ dialingCode: '61', trunkPrefix: '0' }),
  kycProviders: [
    {
      id: 'tfn',
      name: 'Tax File Number',
      kind: 'tax-authority',
      envPrefix: 'AU_TFN',
      idFormat: /^\d{8,9}$/,
    },
    {
      id: 'ato',
      name: 'Australian Taxation Office',
      kind: 'tax-authority',
      envPrefix: 'ATO',
    },
    {
      id: 'equifax_au',
      name: 'Equifax Australia',
      kind: 'credit-bureau',
      envPrefix: 'EQUIFAX_AU',
    },
    {
      id: 'asic',
      name: 'ASIC (Business Registry)',
      kind: 'business-registry',
      envPrefix: 'ASIC',
    },
  ],
  paymentGateways: [
    { id: 'payid', name: 'PayID / NPP', kind: 'bank-rail', envPrefix: 'PAYID' },
    { id: 'becs', name: 'BECS Direct Debit', kind: 'bank-rail', envPrefix: 'BECS' },
    { id: 'stripe', name: 'Stripe', kind: 'card', envPrefix: 'STRIPE' },
  ],
  compliance: {
    minDepositMonths: 0,
    maxDepositMonths: 1, // VIC / NSW cap bond at 4 weeks for rent ≤ $350/wk
    noticePeriodDays: 60,
    minimumLeaseMonths: 6,
    subleaseConsent: 'consent-required',
    lateFeeCapRate: null,
    depositReturnDays: 14,
  },
  documentTemplates: [
    {
      id: 'lease-agreement',
      name: 'Residential Tenancy Agreement (AU)',
      templatePath: 'au/lease-agreement.hbs',
      locale: 'en-AU',
    },
  ],
};

export const australiaProfile: ExtendedCountryProfile = {
  plugin: australiaCore,
  languages: ['en'],
  dateFormat: 'DD/MM/YYYY',
  minorUnitDivisor: 100,
  nationalIdValidator: buildRegexIdValidator({
    id: 'au-tfn',
    label: 'Tax File Number',
    pattern: /^\d{8,9}$/,
    piiSensitive: true,
  }),
  taxRegime: stubWithholding(
    'AU-ATO-ITAA36-128B',
    'CONFIGURE_FOR_YOUR_JURISDICTION: ordinary rental income is NOT withholding-taxed in AU. Foreign-resident landlords must file annual returns; configure operator rules.'
  ),
  paymentRails: buildPaymentRailsPort([
    {
      id: 'payid',
      label: 'PayID (NPP / Osko)',
      kind: 'bank-transfer',
      currency: 'AUD',
      minAmountMinorUnits: 1,
      settlementLagHours: 1,
      integrationAdapterHint: 'PAYID',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'becs',
      label: 'BECS Direct Debit',
      kind: 'bank-transfer',
      currency: 'AUD',
      minAmountMinorUnits: 1,
      settlementLagHours: 72,
      integrationAdapterHint: 'BECS',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'stripe',
      label: 'Stripe (Card)',
      kind: 'card',
      currency: 'AUD',
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
        id: 'au-bond-lodged',
        label: 'Bond must be lodged with state authority (RTBA VIC / RBA NSW)',
        mandatory: true,
        citation: 'State Residential Tenancies Act',
      },
    ],
    noticeWindowDaysByReason: {
      'end-of-term': 60,
      'non-payment': 14,
    },
    depositCapByRegime: {
      'residential-standard': {
        maxWeeksOfRent: 4,
        citation: 'VIC RTA 2018 § 31 / NSW RTA 2010 § 159',
      },
    },
    rentIncreaseCapByRegime: {
      'residential-standard': {
        citation: 'No statutory cap; state frequency rules (≤ 1/year VIC).',
      },
    },
    defaultNoticeWindowDays: 60,
  }),
  tenantScreening: buildStubScreeningPort('EQUIFAX_AU'),
};

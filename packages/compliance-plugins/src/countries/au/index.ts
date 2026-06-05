/**
 * Australia (AU) — ATO foreign-resident withholding + state mineral royalties.
 *
 * Source: ITAA 1936 § 128B — final withholding on interest-like structures;
 * ordinary mineral proceeds are assessed through a tax return, NOT withheld.
 * State royalties (e.g. WA gold royalty 2.5% of value) apply separately. This
 * plugin flags the area as operator-configurable so consumers don't
 * auto-withhold incorrectly.
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
    minBondMonths: 0,
    maxBondMonths: 1, // state royalty-bond norm ≈ 4 weeks
    noticePeriodDays: 60,
    minimumTermMonths: 6,
    subSupplyConsent: 'consent-required',
    lateFeeCapRate: null,
    bondReturnDays: 14,
  },
  documentTemplates: [
    {
      id: 'offtake-agreement',
      name: 'Mineral Offtake Agreement (AU)',
      templatePath: 'au/offtake-agreement.hbs',
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
    'CONFIGURE_FOR_YOUR_JURISDICTION: ordinary mineral proceeds are NOT withholding-taxed federally in AU. State royalties (e.g. WA gold 2.5%) apply; foreign-resident operators file annual returns. Configure operator rules.'
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
  miningLaw: buildMiningLawPort({
    requiredClauses: [
      {
        id: 'au-bond-lodged',
        label: 'Rehabilitation / performance bond lodged with state mines authority',
        mandatory: true,
        citation: 'State Mining Act (e.g. Mining Act 1978 WA)',
      },
    ],
    noticeWindowDaysByReason: {
      'licence-expiry': 60,
      'royalty-default': 14,
    },
    bondCapByRegime: {
      'artisanal-standard': {
        maxWeeksOfRoyalty: 4,
        citation: 'State mining-bond practice (WA / NSW)',
      },
    },
    royaltyEscalationCapByRegime: {
      'artisanal-standard': {
        citation: 'No statutory cap; state royalty review rules apply.',
      },
    },
    defaultNoticeWindowDays: 60,
  }),
  counterpartyScreening: buildStubScreeningPort('EQUIFAX_AU'),
};

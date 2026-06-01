/**
 * Mexico (MX) — ISR withholding on mineral proceeds + mining duties.
 *
 * Source: Ley del ISR — corporate payers withhold 10% ISR on gross mineral
 * proceeds. The Ley Minera + LFD impose a special mining duty (derecho
 * especial sobre minería, ~7.5% of EBIT) and an extraordinary duty on
 * precious metals. Plugin defaults to 10% withholding; mining duties are
 * configured per operator.
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

const mexicoCore: CountryPlugin = {
  countryCode: 'MX',
  countryName: 'Mexico',
  currencyCode: 'MXN',
  currencySymbol: '$',
  phoneCountryCode: '52',
  normalizePhone: buildPhoneNormalizer({ dialingCode: '52' }),
  kycProviders: [
    {
      id: 'curp',
      name: 'CURP (Clave Única de Registro de Población)',
      kind: 'national-id',
      envPrefix: 'MX_CURP',
      idFormat: /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/,
    },
    {
      id: 'rfc',
      name: 'RFC (Registro Federal de Contribuyentes)',
      kind: 'tax-authority',
      envPrefix: 'MX_RFC',
      idFormat: /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/,
    },
    {
      id: 'sat',
      name: 'SAT (Servicio de Administración Tributaria)',
      kind: 'tax-authority',
      envPrefix: 'SAT',
    },
    {
      id: 'buro_credito',
      name: 'Buró de Crédito',
      kind: 'credit-bureau',
      envPrefix: 'BURO_CREDITO',
    },
  ],
  paymentGateways: [
    { id: 'spei', name: 'SPEI', kind: 'bank-rail', envPrefix: 'SPEI' },
    { id: 'stripe', name: 'Stripe', kind: 'card', envPrefix: 'STRIPE' },
    {
      id: 'mercadopago',
      name: 'Mercado Pago',
      kind: 'card',
      envPrefix: 'MERCADOPAGO',
    },
  ],
  compliance: {
    minBondMonths: 1,
    maxBondMonths: 2,
    noticePeriodDays: 30,
    minimumTermMonths: 12,
    subSupplyConsent: 'consent-required',
    lateFeeCapRate: null,
    bondReturnDays: 30,
  },
  documentTemplates: [
    {
      id: 'offtake-agreement',
      name: 'Contrato de Suministro de Minerales (MX Mineral Offtake)',
      templatePath: 'mx/offtake-agreement.hbs',
      locale: 'es-MX',
    },
  ],
};

export const mexicoProfile: ExtendedCountryProfile = {
  plugin: mexicoCore,
  languages: ['es', 'en'],
  dateFormat: 'DD/MM/YYYY',
  minorUnitDivisor: 100,
  nationalIdValidator: buildRegexIdValidator({
    id: 'mx-rfc',
    label: 'RFC',
    pattern: /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/,
  }),
  taxRegime: buildFlatWithholding(
    10,
    'MX-SAT-LISR-Art-116',
    'ISR withholding on mineral proceeds: 10% on gross when the payer is a corporation (LISR). Configure the Ley Minera mining duty (derecho especial ~7.5%) per operator.'
  ),
  paymentRails: buildPaymentRailsPort([
    {
      id: 'spei',
      label: 'SPEI (real-time bank transfer)',
      kind: 'bank-transfer',
      currency: 'MXN',
      minAmountMinorUnits: 1,
      settlementLagHours: 1,
      integrationAdapterHint: 'SPEI',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'stripe',
      label: 'Stripe (Card)',
      kind: 'card',
      currency: 'MXN',
      minAmountMinorUnits: 50,
      settlementLagHours: 48,
      integrationAdapterHint: 'STRIPE',
      supportsCollection: true,
      supportsDisbursement: false,
    },
    {
      id: 'mercadopago',
      label: 'Mercado Pago',
      kind: 'wallet',
      currency: 'MXN',
      minAmountMinorUnits: 100,
      settlementLagHours: 48,
      integrationAdapterHint: 'MERCADOPAGO',
      supportsCollection: true,
      supportsDisbursement: false,
    },
  ]),
  miningLaw: buildMiningLawPort({
    requiredClauses: [
      {
        id: 'mx-ley-minera',
        label: 'Suministro regido por la Ley Minera (concesión minera)',
        mandatory: true,
        citation: 'Ley Minera; Ley Federal de Derechos',
      },
    ],
    noticeWindowDaysByReason: {
      'licence-expiry': 30,
      'royalty-default': 30,
    },
    bondCapByRegime: {
      'artisanal-standard': {
        maxMonthsOfRoyalty: 2,
        citation: 'No statutory cap federal; industry norm 1-2 meses de regalía.',
      },
    },
    royaltyEscalationCapByRegime: {
      'artisanal-standard': {
        indexedTo: 'LOCAL_INDEX',
        citation: 'INPC (Banxico) — indexation by agreement.',
      },
    },
    defaultNoticeWindowDays: 30,
  }),
  counterpartyScreening: buildStubScreeningPort('BURO_CREDITO_MX'),
};

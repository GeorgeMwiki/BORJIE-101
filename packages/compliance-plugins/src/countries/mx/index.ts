/**
 * Mexico (MX) — ISR withholding on rental income.
 *
 * Source: Ley del ISR Art. 116 — individual landlords can elect a monthly
 * provisional-payment regime; corporate payers withhold 10% ISR on gross
 * rent (Art. 115). Plugin defaults to 10%, stubs individual-regime choice
 * for operator configuration.
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
    minDepositMonths: 1,
    maxDepositMonths: 2,
    noticePeriodDays: 30,
    minimumLeaseMonths: 12,
    subleaseConsent: 'consent-required',
    lateFeeCapRate: null,
    depositReturnDays: 30,
  },
  documentTemplates: [
    {
      id: 'lease-agreement',
      name: 'Contrato de Arrendamiento (MX)',
      templatePath: 'mx/lease-agreement.hbs',
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
    'ISR withholding on rental income: 10% on gross when landlord is individual and payer is a corporation (LISR Art. 116). Configure monthly provisional-payment regime per landlord.'
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
  leaseLaw: buildLeaseLawPort({
    requiredClauses: [
      {
        id: 'mx-codigo-civil',
        label: 'Contrato regido por Código Civil estatal (varies by state)',
        mandatory: true,
        citation: 'Código Civil (state-specific)',
      },
    ],
    noticeWindowDaysByReason: {
      'end-of-term': 30,
      'non-payment': 30,
    },
    depositCapByRegime: {
      'residential-standard': {
        maxMonthsOfRent: 2,
        citation: 'No statutory cap federal; industry norm 1-2 meses.',
      },
    },
    rentIncreaseCapByRegime: {
      'residential-standard': {
        indexedTo: 'LOCAL_INDEX',
        citation: 'INPC (Banxico) — indexation by agreement.',
      },
    },
    defaultNoticeWindowDays: 30,
  }),
  tenantScreening: buildStubScreeningPort('BURO_CREDITO_MX'),
};

/**
 * France (FR) — prélèvement à la source + prélèvements sociaux on mineral
 * proceeds.
 *
 * Source: CGI (Code général des impôts). Non-resident operators pay:
 *   - 20% minimum income-tax withholding on net mineral proceeds
 *   - 17.2% prélèvements sociaux (most cases)
 * Plugin uses 20% as the operator-configurable minimum; social charges
 * are added via operator override per taxpayer residence. Mining tenure
 * is governed by the Code minier (redevances minières apply).
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

const franceCore: CountryPlugin = {
  countryCode: 'FR',
  countryName: 'France',
  currencyCode: 'EUR',
  currencySymbol: '€',
  phoneCountryCode: '33',
  normalizePhone: buildPhoneNormalizer({ dialingCode: '33', trunkPrefix: '0' }),
  kycProviders: [
    {
      id: 'numero_fiscal',
      name: 'Numéro fiscal de référence',
      kind: 'tax-authority',
      envPrefix: 'FR_NUMERO_FISCAL',
      idFormat: /^\d{13}$/,
    },
    {
      id: 'dgfip',
      name: 'Direction générale des Finances publiques',
      kind: 'tax-authority',
      envPrefix: 'DGFIP',
    },
    {
      id: 'fichier_fcc',
      name: 'Fichier central des chèques (Banque de France)',
      kind: 'credit-bureau',
      envPrefix: 'FCC_FR',
    },
    {
      id: 'rcs',
      name: 'Registre du Commerce et des Sociétés',
      kind: 'business-registry',
      envPrefix: 'RCS',
    },
  ],
  paymentGateways: [
    { id: 'sepa', name: 'SEPA Direct Debit', kind: 'bank-rail', envPrefix: 'SEPA' },
    { id: 'stripe', name: 'Stripe', kind: 'card', envPrefix: 'STRIPE' },
  ],
  compliance: {
    minBondMonths: 0,
    maxBondMonths: 2, // performance-bond norm 1–2 months royalty
    noticePeriodDays: 90,
    minimumTermMonths: 36, // typical multi-year supply term
    subSupplyConsent: 'consent-required',
    lateFeeCapRate: null,
    bondReturnDays: 60,
  },
  documentTemplates: [
    {
      id: 'offtake-agreement',
      name: 'Contrat de fourniture de minerais (FR Mineral Offtake)',
      templatePath: 'fr/offtake-agreement.hbs',
      locale: 'fr-FR',
    },
  ],
};

export const franceProfile: ExtendedCountryProfile = {
  plugin: franceCore,
  languages: ['fr', 'en'],
  dateFormat: 'DD/MM/YYYY',
  minorUnitDivisor: 100,
  nationalIdValidator: buildRegexIdValidator({
    id: 'fr-numero-fiscal',
    label: 'Numéro fiscal',
    pattern: /^\d{13}$/,
    piiSensitive: true,
  }),
  taxRegime: buildFlatWithholding(
    20,
    'FR-DGFIP-CGI-Art244bis',
    'Non-resident minimum income-tax withholding: 20% on net mineral proceeds (CGI Art. 244 bis). Add 17.2% prélèvements sociaux where applicable.'
  ),
  paymentRails: buildPaymentRailsPort([
    {
      id: 'sepa',
      label: 'SEPA Direct Debit',
      kind: 'bank-transfer',
      currency: 'EUR',
      minAmountMinorUnits: 1,
      settlementLagHours: 48,
      integrationAdapterHint: 'SEPA',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'stripe',
      label: 'Stripe (Card)',
      kind: 'card',
      currency: 'EUR',
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
        id: 'fr-code-minier',
        label: 'Fourniture régie par le Code minier',
        mandatory: true,
        citation: 'Code minier (redevances minières)',
      },
      {
        id: 'fr-impact-env',
        label: 'Étude d\'impact environnemental attachée',
        mandatory: true,
        citation: 'Code de l\'environnement (autorisation environnementale)',
      },
    ],
    noticeWindowDaysByReason: {
      'licence-expiry': 90,
      'royalty-default': 60,
    },
    bondCapByRegime: {
      'artisanal-standard': {
        maxMonthsOfRoyalty: 1,
        citation: 'Code minier — garantie (≈ 1 mois redevance)',
      },
      'artisanal-controlled': {
        maxMonthsOfRoyalty: 2,
        citation: 'Code minier — garantie renforcée (≈ 2 mois redevance)',
      },
    },
    royaltyEscalationCapByRegime: {
      'artisanal-standard': {
        indexedTo: 'LOCAL_INDEX',
        citation: 'Indice INSEE applicable aux redevances minières.',
      },
    },
    defaultNoticeWindowDays: 90,
  }),
  counterpartyScreening: buildStubScreeningPort('FCC_FR'),
};

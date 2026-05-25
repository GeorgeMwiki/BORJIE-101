/**
 * France (FR) — prélèvement à la source + prélèvements sociaux on rental.
 *
 * Source: CGI (Code général des impôts). Non-resident landlords pay:
 *   - 20% minimum income-tax withholding on net rental income
 *   - 17.2% prélèvements sociaux (most cases)
 * Plugin uses 20% as the operator-configurable minimum; social charges
 * are added via operator override per taxpayer residence.
 *
 * Deposit: Loi du 6 juillet 1989 § 22 — 1 month cap for unfurnished,
 * 2 months for furnished. Notice: 3 months for unfurnished tenant
 * departure (1 month in tense markets).
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
    minDepositMonths: 0,
    maxDepositMonths: 2, // 1 for unfurnished, 2 for furnished
    noticePeriodDays: 90,
    minimumLeaseMonths: 36, // unfurnished 3y; furnished 1y
    subleaseConsent: 'consent-required',
    lateFeeCapRate: null,
    depositReturnDays: 60,
  },
  documentTemplates: [
    {
      id: 'lease-agreement',
      name: 'Contrat de bail (FR)',
      templatePath: 'fr/lease-agreement.hbs',
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
    'Non-resident minimum income-tax withholding: 20% on net rental income (CGI Art. 244 bis). Add 17.2% prélèvements sociaux where applicable.'
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
  leaseLaw: buildLeaseLawPort({
    requiredClauses: [
      {
        id: 'fr-loi-89-462',
        label: 'Bail régi par la Loi du 6 juillet 1989',
        mandatory: true,
        citation: 'Loi n° 89-462 du 6 juillet 1989',
      },
      {
        id: 'fr-dpe',
        label: 'Diagnostic de performance énergétique (DPE) attaché',
        mandatory: true,
        citation: 'Code construction § L126-26',
      },
    ],
    noticeWindowDaysByReason: {
      'end-of-term': 90, // unfurnished 3mo
      'non-payment': 60,
    },
    depositCapByRegime: {
      'residential-standard': {
        maxMonthsOfRent: 1,
        citation: 'Loi 89-462 § 22 (1 mois — non meublé)',
      },
      'residential-rent-controlled': {
        maxMonthsOfRent: 2,
        citation: 'Loi 89-462 § 25-6 (2 mois — meublé)',
      },
    },
    rentIncreaseCapByRegime: {
      'residential-standard': {
        indexedTo: 'LOCAL_INDEX',
        citation: 'IRL (Indice de référence des loyers) — INSEE.',
      },
    },
    defaultNoticeWindowDays: 90,
  }),
  tenantScreening: buildStubScreeningPort('FCC_FR'),
};

/**
 * Germany (DE) — Kapitalertragsteuer + Solidaritätszuschlag on non-resident
 * landlords. Statutory residential-lease rules from BGB §§ 535 ff.
 *
 * Sources:
 *  - § 50a EStG (Einkommensteuergesetz) — withholding for non-residents
 *  - § 551 BGB — deposit cap at 3 months Kaltmiete
 *  - § 573c BGB — notice periods (tenant: 3 months; landlord: 3 / 6 / 9 m)
 *
 * The withholding rate combines 15% corporate income tax (körperschaft-
 * steuer) on net rental + 5.5% Soli surcharge. The port uses a blended
 * ~15.825% on gross as a conservative operator-configurable default.
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

const germanyCore: CountryPlugin = {
  countryCode: 'DE',
  countryName: 'Germany',
  currencyCode: 'EUR',
  currencySymbol: '€',
  phoneCountryCode: '49',
  normalizePhone: buildPhoneNormalizer({ dialingCode: '49', trunkPrefix: '0' }),
  kycProviders: [
    {
      id: 'personalausweis',
      name: 'Personalausweis (National ID)',
      kind: 'national-id',
      envPrefix: 'PERSONALAUSWEIS',
      idFormat: /^[A-Z0-9]{9,10}$/,
    },
    {
      id: 'schufa',
      name: 'SCHUFA Holding AG',
      kind: 'credit-bureau',
      envPrefix: 'SCHUFA',
    },
    {
      id: 'handelsregister',
      name: 'Handelsregister (Commercial Register)',
      kind: 'business-registry',
      envPrefix: 'HANDELSREGISTER',
    },
    {
      id: 'finanzamt',
      name: 'Finanzamt (Tax Authority)',
      kind: 'tax-authority',
      envPrefix: 'FINANZAMT',
    },
  ],
  paymentGateways: [
    { id: 'sepa', name: 'SEPA Direct Debit', kind: 'bank-rail', envPrefix: 'SEPA' },
    { id: 'stripe', name: 'Stripe', kind: 'card', envPrefix: 'STRIPE' },
    { id: 'klarna', name: 'Klarna', kind: 'card', envPrefix: 'KLARNA' },
  ],
  compliance: {
    minDepositMonths: 0,
    maxDepositMonths: 3, // § 551 BGB — Kaltmiete x 3
    noticePeriodDays: 90,
    minimumLeaseMonths: 1,
    subleaseConsent: 'consent-required',
    lateFeeCapRate: null,
    depositReturnDays: 180,
  },
  documentTemplates: [
    {
      id: 'lease-agreement',
      name: 'Wohnraummietvertrag (DE)',
      templatePath: 'de/lease-agreement.hbs',
      locale: 'de-DE',
    },
  ],
};

export const germanyProfile: ExtendedCountryProfile = {
  plugin: germanyCore,
  languages: ['de', 'en'],
  dateFormat: 'DD.MM.YYYY',
  minorUnitDivisor: 100,
  nationalIdValidator: buildRegexIdValidator({
    id: 'de-personalausweis',
    label: 'Personalausweis',
    pattern: /^[A-Z0-9]{9,10}$/,
  }),
  taxRegime: buildFlatWithholding(
    15.825,
    'DE-FINANZAMT-50a-EStG',
    'Blended 15% KSt + 5.5% Soli surcharge on gross rent for non-resident landlords (§ 50a EStG).'
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
    {
      id: 'klarna',
      label: 'Klarna',
      kind: 'card',
      currency: 'EUR',
      minAmountMinorUnits: 100,
      settlementLagHours: 72,
      integrationAdapterHint: 'KLARNA',
      supportsCollection: true,
      supportsDisbursement: false,
    },
  ]),
  leaseLaw: buildLeaseLawPort({
    requiredClauses: [
      {
        id: 'de-kaltmiete',
        label: 'Kaltmiete (net-cold rent) amount and due date',
        mandatory: true,
        citation: 'BGB § 535 Abs. 2',
      },
      {
        id: 'de-deposit',
        label: 'Security deposit (Mietkaution) — max 3 Kaltmieten',
        mandatory: true,
        citation: 'BGB § 551',
      },
      {
        id: 'de-kuendigung',
        label: 'Notice-period clause (Kündigungsfristen)',
        mandatory: true,
        citation: 'BGB § 573c',
      },
    ],
    noticeWindowDaysByReason: {
      'end-of-term': 90,
      'renewal-non-continuation': 90,
      'non-payment': 14,
      'breach-of-covenant': 30,
    },
    depositCapByRegime: {
      'residential-standard': {
        maxMonthsOfRent: 3,
        citation: 'BGB § 551 Abs. 1 (Kaltmiete x 3)',
      },
    },
    rentIncreaseCapByRegime: {
      'residential-standard': {
        pctPerAnnum: 20,
        citation: 'BGB § 558 (Kappungsgrenze — 20% / 3 years, 15% in tight markets)',
      },
    },
    defaultNoticeWindowDays: 90,
  }),
  tenantScreening: buildStubScreeningPort('SCHUFA_DE'),
};

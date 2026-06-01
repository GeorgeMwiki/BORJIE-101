/**
 * Germany (DE) — Kapitalertragsteuer + Solidaritätszuschlag on non-resident
 * mineral operators. Statutory mining rules from the Bundesberggesetz (BBergG).
 *
 * Sources:
 *  - § 50a EStG (Einkommensteuergesetz) — withholding for non-residents
 *  - BBergG (Federal Mining Act) — Bergbauberechtigung, field-fee (Feldes-
 *    abgabe) and production-royalty (Förderabgabe) framework
 *  - § 31 BBergG — Förderabgabe (production royalty) set by the Länder
 *
 * The withholding rate combines 15% corporate income tax (körperschaft-
 * steuer) on net proceeds + 5.5% Soli surcharge. The port uses a blended
 * ~15.825% on gross as a conservative operator-configurable default.
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
    minBondMonths: 0,
    maxBondMonths: 3, // performance-bond norm ~3 months royalty
    noticePeriodDays: 90,
    minimumTermMonths: 1,
    subSupplyConsent: 'consent-required',
    lateFeeCapRate: null,
    bondReturnDays: 180,
  },
  documentTemplates: [
    {
      id: 'offtake-agreement',
      name: 'Mineralien-Liefervertrag (DE Mineral Offtake)',
      templatePath: 'de/offtake-agreement.hbs',
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
    'Blended 15% KSt + 5.5% Soli surcharge on gross mineral proceeds for non-resident operators (§ 50a EStG). Production royalty (Förderabgabe) is set separately by the Land.'
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
  miningLaw: buildMiningLawPort({
    requiredClauses: [
      {
        id: 'de-foerderabgabe',
        label: 'Förderabgabe (production royalty) rate and due date',
        mandatory: true,
        citation: 'BBergG § 31',
      },
      {
        id: 'de-bond',
        label: 'Performance / reclamation bond (Sicherheitsleistung)',
        mandatory: true,
        citation: 'BBergG § 56 Abs. 2',
      },
      {
        id: 'de-kuendigung',
        label: 'Notice-period clause (Kündigungsfristen)',
        mandatory: true,
        citation: 'BBergG; BGB § 573c (suppletory)',
      },
    ],
    noticeWindowDaysByReason: {
      'licence-expiry': 90,
      'renewal-non-continuation': 90,
      'royalty-default': 14,
      'breach-of-condition': 30,
    },
    bondCapByRegime: {
      'artisanal-standard': {
        maxMonthsOfRoyalty: 3,
        citation: 'BBergG § 56 — Sicherheitsleistung (≈ 3 months royalty norm)',
      },
    },
    royaltyEscalationCapByRegime: {
      'artisanal-standard': {
        pctPerAnnum: 20,
        citation: 'Länder Förderabgabe practice (escalation reviewed periodically)',
      },
    },
    defaultNoticeWindowDays: 90,
  }),
  counterpartyScreening: buildStubScreeningPort('SCHUFA_DE'),
};

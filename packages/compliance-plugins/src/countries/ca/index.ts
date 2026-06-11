/**
 * Canada (CA) — CRA Part XIII withholding on non-resident mineral proceeds.
 *
 * Source: Income Tax Act Part XIII § 212(1)(d) — 25% on gross proceeds paid
 * to a non-resident. Can be reduced via Form NR6 election on net income.
 * Provincial mining acts differ (ON: Mining Act; BC: Mineral Tenure Act;
 * QC: Mining Act). Plugin exposes federal baseline; consumers stack
 * provincial overrides via their own layer.
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

const canadaCore: CountryPlugin = {
  countryCode: 'CA',
  countryName: 'Canada',
  currencyCode: 'CAD',
  currencySymbol: 'C$',
  phoneCountryCode: '1', // NANP — same dialling code as US
  normalizePhone: buildPhoneNormalizer({ dialingCode: '1' }),
  kycProviders: [
    {
      id: 'sin',
      name: 'Social Insurance Number',
      kind: 'national-id',
      envPrefix: 'CA_SIN',
      idFormat: /^\d{3}-?\d{3}-?\d{3}$/,
    },
    {
      id: 'cra',
      name: 'Canada Revenue Agency',
      kind: 'tax-authority',
      envPrefix: 'CRA',
    },
    {
      id: 'equifax_ca',
      name: 'Equifax Canada',
      kind: 'credit-bureau',
      envPrefix: 'EQUIFAX_CA',
    },
  ],
  paymentGateways: [
    {
      id: 'interac',
      name: 'Interac e-Transfer',
      kind: 'bank-rail',
      envPrefix: 'INTERAC',
    },
    { id: 'ach_ca', name: 'EFT / ACH (CA)', kind: 'bank-rail', envPrefix: 'ACH_CA' },
    { id: 'stripe', name: 'Stripe', kind: 'card', envPrefix: 'STRIPE' },
  ],
  compliance: {
    minBondMonths: 0,
    maxBondMonths: 1, // ON: ~1 month royalty bond norm; other provinces vary
    noticePeriodDays: 60,
    minimumTermMonths: 1,
    subSupplyConsent: 'consent-required',
    lateFeeCapRate: null,
    bondReturnDays: 21,
  },
  documentTemplates: [
    {
      id: 'offtake-agreement',
      name: 'Mineral Offtake Agreement (CA federal)',
      templatePath: 'ca/offtake-agreement.hbs',
      locale: 'en-CA',
    },
  ],
};

/** SIN Luhn-algorithm check. */
function sinLuhnValid(raw: string): boolean {
  const digits = raw.replace(/\D+/g, '');
  if (digits.length !== 9) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(digits[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export const canadaProfile: ExtendedCountryProfile = {
  plugin: canadaCore,
  languages: ['en', 'fr'],
  dateFormat: 'YYYY-MM-DD',
  minorUnitDivisor: 100,
  nationalIdValidator: {
    id: 'ca-sin',
    label: 'Social Insurance Number',
    validate(raw) {
      if (!raw || raw.trim().length === 0) {
        return { status: 'invalid', ruleId: 'ca-sin', note: 'SIN is empty' };
      }
      if (!/^\d{3}-?\d{3}-?\d{3}$/.test(raw.trim())) {
        return {
          status: 'invalid',
          ruleId: 'ca-sin',
          note: 'SIN must be 9 digits (formatted 123-456-789).',
          piiSensitive: true,
        };
      }
      if (!sinLuhnValid(raw)) {
        return {
          status: 'invalid',
          ruleId: 'ca-sin-luhn',
          note: 'SIN failed Luhn check.',
          piiSensitive: true,
        };
      }
      return { status: 'valid', ruleId: 'ca-sin-luhn', piiSensitive: true };
    },
  },
  taxRegime: buildFlatWithholding(
    25,
    'CA-CRA-ITA-PartXIII',
    'Part XIII non-resident withholding: 25% on gross mineral proceeds (ITA § 212(1)(d)). Reducible via NR6 election.'
  ),
  paymentRails: buildPaymentRailsPort([
    {
      id: 'interac',
      label: 'Interac e-Transfer',
      kind: 'bank-transfer',
      currency: 'CAD',
      minAmountMinorUnits: 1,
      settlementLagHours: 1,
      integrationAdapterHint: 'INTERAC',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'ach_ca',
      label: 'EFT (ACH Canada)',
      kind: 'bank-transfer',
      currency: 'CAD',
      minAmountMinorUnits: 1,
      settlementLagHours: 72,
      integrationAdapterHint: 'ACH_CA',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'stripe',
      label: 'Stripe (Card)',
      kind: 'card',
      currency: 'CAD',
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
        id: 'ca-federal-baseline',
        label: 'Provincial Mining Act applies — select province',
        mandatory: true,
        citation: 'ITA baseline — provincial Mining Act governs substance.',
      },
    ],
    noticeWindowDaysByReason: {
      'licence-expiry': 60,
      'royalty-default': 14,
    },
    bondCapByRegime: {
      'artisanal-standard': {
        maxMonthsOfRoyalty: 1,
        citation: 'Typical: ~1 month royalty bond. ON Mining Act.',
      },
    },
    royaltyEscalationCapByRegime: {
      'artisanal-standard': {
        citation:
          'Provincial — ON mining-tax guideline published annually; BC mineral-tax CPI-linked.',
      },
    },
    defaultNoticeWindowDays: 60,
  }),
  counterpartyScreening: buildStubScreeningPort('EQUIFAX_CA'),
};

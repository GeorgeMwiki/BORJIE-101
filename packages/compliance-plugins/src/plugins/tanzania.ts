/**
 * Tanzania (TZ) mining-compliance plugin.
 *
 * Preserves every piece of Tanzania-specific logic that used to live inline
 * in identity / payments / tax services. Env-var prefixes match the existing
 * `.env` patterns — real credentials stay in the environment, never in code.
 *
 * Statutory defaults (notice periods, performance-bond caps) sourced from the
 * Mining Act 2010 (am. 2017) and its royalty schedule. Confirm with counsel
 * before going live.
 */

import { buildPhoneNormalizer } from '../core/phone.js';
import type { CountryPlugin } from '../core/types.js';
import {
  flatRateWithholding,
  type TaxRegimePort,
} from '../ports/tax-regime.port.js';
import {
  buildGenericCsvPayload,
  type TaxFilingPort,
} from '../ports/tax-filing.port.js';
import type { PaymentRailPort } from '../ports/payment-rail.port.js';
import {
  buildStubBureauResult,
  type CounterpartyScreeningPort,
} from '../ports/counterparty-screening.port.js';
import type { MiningLawPort } from '../ports/mining-law.port.js';

// --- Tanzania port implementations ------------------------------------------

/** TRA mineral royalty: 6% on gross market value (Mining Act 2010 §87). */
const tanzaniaTaxRegime: TaxRegimePort = {
  calculateWithholding(grossValueMinorUnits, _currency, _period) {
    return flatRateWithholding(
      grossValueMinorUnits,
      6,
      'TRA-ROYALTY',
      'TRA mineral royalty — 6% on gross market value of minerals (Mining Act 2010 §87).'
    );
  },
};

const tanzaniaTaxFiling: TaxFilingPort = {
  prepareFiling(run, _operatorProfile, _period) {
    return {
      filingFormat: 'csv',
      payload: buildGenericCsvPayload(run),
      targetRegulator: 'TRA',
      submitEndpointHint: 'https://taxportal.tra.go.tz',
      instructions:
        'Upload the CSV to the TRA Tax Portal under Mineral Royalty Returns. ' +
        'File by the 7th of the month following the period.',
    };
  },
};

const tanzaniaPaymentRails: PaymentRailPort = {
  listRails() {
    return Object.freeze([
      { id: 'mpesa_tz', label: 'M-Pesa (Vodacom)', kind: 'mobile-money' as const, currency: 'TZS', minAmountMinorUnits: 500, settlementLagHours: 2, integrationAdapterHint: 'MPESA', supportsCollection: true, supportsDisbursement: true },
      { id: 'tigopesa', label: 'Tigo Pesa', kind: 'mobile-money' as const, currency: 'TZS', minAmountMinorUnits: 500, settlementLagHours: 2, integrationAdapterHint: 'TIGOPESA', supportsCollection: true, supportsDisbursement: true },
      { id: 'airtelmoney_tz', label: 'Airtel Money (TZ)', kind: 'mobile-money' as const, currency: 'TZS', minAmountMinorUnits: 500, settlementLagHours: 4, integrationAdapterHint: 'AIRTELMONEY', supportsCollection: true, supportsDisbursement: true },
      { id: 'halopesa', label: 'Halopesa', kind: 'mobile-money' as const, currency: 'TZS', minAmountMinorUnits: 500, settlementLagHours: 4, integrationAdapterHint: 'HALOPESA', supportsCollection: true, supportsDisbursement: true },
      { id: 'gepg', label: 'Government Electronic Payment Gateway', kind: 'government-portal' as const, currency: 'TZS', minAmountMinorUnits: 1000, settlementLagHours: 24, integrationAdapterHint: 'GEPG', supportsCollection: true, supportsDisbursement: false },
      { id: 'bank_tz', label: 'Bank transfer (TZ)', kind: 'bank-transfer' as const, currency: 'TZS', minAmountMinorUnits: 1000, settlementLagHours: 24, integrationAdapterHint: null, supportsCollection: true, supportsDisbursement: true },
    ]);
  },
};

const tanzaniaCounterpartyScreening: CounterpartyScreeningPort = {
  async lookupBureau(identityDocument, _country, consentToken) {
    if (!consentToken) {
      return buildStubBureauResult('CRB_TZ', ['CONSENT_TOKEN_INVALID']);
    }
    void identityDocument;
    // Follow-up ph-Z-global (#33): wire real CRB TZ adapter when env CRB_TZ_KEY set.
    return buildStubBureauResult('CRB_TZ');
  },
};

const tanzaniaMiningLaw: MiningLawPort = {
  requiredClauses(_operationKind) {
    return Object.freeze([
      { id: 'parties', label: 'Parties', mandatory: true, citation: 'Mining Act 2010 §8 (mineral rights).' },
      { id: 'site', label: 'Description of licensed mining area', mandatory: true, citation: 'Mining Act 2010 §8.' },
      { id: 'royalty-rate', label: 'Royalty/payment rate and frequency in TZS', mandatory: true, citation: 'Mining Act 2010 §87 (royalties).' },
      { id: 'tra-tin', label: "Operator's TRA TIN disclosure", mandatory: true, citation: 'TRA withholding-agent requirement.' },
    ]);
  },
  noticeWindowDays(reason) {
    switch (reason) {
      case 'royalty-default': return 30;
      case 'licence-expiry':
      case 'renewal-non-continuation': return 90;
      case 'state-repossession': return 180;
      case 'breach-of-condition': return 30;
      case 'illegal-mining':
      case 'environmental-breach': return 14;
      default: return null;
    }
  },
  bondCapMultiple(regime) {
    if (regime === 'industrial') return { maxMonthsOfRoyalty: 12, citation: 'Market norm.' };
    return { maxMonthsOfRoyalty: 6, citation: 'Mining (Mineral Rights) Regulations 2018.' };
  },
  royaltyEscalationCap(_regime) {
    return { citation: 'No statutory cap — arbitrated by the Mining Commission on dispute.' };
  },
};

export const tanzaniaPlugin: CountryPlugin = {
  countryCode: 'TZ',
  countryName: 'Tanzania',
  currencyCode: 'TZS',
  currencySymbol: 'TSh',
  phoneCountryCode: '255',
  normalizePhone: buildPhoneNormalizer({ dialingCode: '255', trunkPrefix: '0' }),
  kycProviders: [
    {
      id: 'nida',
      name: 'National Identification Authority',
      kind: 'national-id',
      envPrefix: 'NIDA',
      idFormat: /^\d{20}$/,
    },
    {
      id: 'crb-tz',
      name: 'Credit Reference Bureau (TZ)',
      kind: 'credit-bureau',
      envPrefix: 'CRB_TZ',
    },
    {
      id: 'brela',
      name: 'Business Registrations and Licensing Agency',
      kind: 'business-registry',
      envPrefix: 'BRELA',
    },
    {
      id: 'tra',
      name: 'Tanzania Revenue Authority',
      kind: 'tax-authority',
      envPrefix: 'TRA',
      idFormat: /^\d{9}$/,
    },
  ],
  paymentGateways: [
    {
      id: 'gepg',
      name: 'Government Electronic Payment Gateway',
      kind: 'government-portal',
      envPrefix: 'GEPG',
    },
    {
      id: 'mpesa_tz',
      name: 'M-Pesa (Vodacom)',
      kind: 'mobile-money',
      envPrefix: 'MPESA',
    },
    {
      id: 'tigopesa',
      name: 'Tigo Pesa',
      kind: 'mobile-money',
      envPrefix: 'TIGOPESA',
    },
    {
      id: 'airtelmoney_tz',
      name: 'Airtel Money (TZ)',
      kind: 'mobile-money',
      envPrefix: 'AIRTELMONEY',
    },
    {
      id: 'halopesa',
      name: 'Halopesa',
      kind: 'mobile-money',
      envPrefix: 'HALOPESA',
    },
  ],
  compliance: {
    minBondMonths: 1,
    maxBondMonths: 6,
    noticePeriodDays: 90,
    minimumTermMonths: 6,
    subSupplyConsent: 'consent-required',
    lateFeeCapRate: null,
    bondReturnDays: 30,
  },
  documentTemplates: [
    {
      id: 'offtake-agreement',
      name: 'Mineral Offtake Agreement (TZ)',
      templatePath: 'tz/offtake-agreement.hbs',
      locale: 'sw-TZ',
    },
    {
      id: 'notice-of-suspension',
      name: 'Notice of Licence Suspension (TZ)',
      templatePath: 'tz/notice-of-suspension.hbs',
      locale: 'sw-TZ',
    },
  ],
  taxRegime: tanzaniaTaxRegime,
  taxFiling: tanzaniaTaxFiling,
  paymentRails: tanzaniaPaymentRails,
  counterpartyScreening: tanzaniaCounterpartyScreening,
  miningLaw: tanzaniaMiningLaw,
};

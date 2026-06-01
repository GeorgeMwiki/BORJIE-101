/**
 * South Africa (ZA) mining-compliance plugin.
 *
 * Defaults based on the Mineral and Petroleum Resources Royalty Act 28 of 2008
 * and SARS requirements. The Mineral Resources regulator handles disputes —
 * surfaced as a tax-authority-adjacent KYC provider so downstream UI knows
 * the dispute channel.
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

// --- South Africa port implementations --------------------------------------

/**
 * SARS levies a mineral royalty under the Mineral and Petroleum Resources
 * Royalty Act 28 of 2008. The headline rate for refined minerals is variable
 * (formula-based); we implement a conservative 7.5% on gross value as a
 * baseline and flag manual configuration for the precise formula.
 */
const southAfricaTaxRegime: TaxRegimePort = {
  calculateWithholding(grossValueMinorUnits, _currency, _period) {
    return flatRateWithholding(
      grossValueMinorUnits,
      7.5,
      'SARS-MINERAL-ROYALTY',
      'SARS mineral royalty — 7.5% baseline on gross value (Mineral and Petroleum Resources Royalty Act 28 of 2008). Refined-mineral formula applies; confirm rate.'
    );
  },
};

const southAfricaTaxFiling: TaxFilingPort = {
  prepareFiling(run, _operatorProfile, _period) {
    return {
      filingFormat: 'csv',
      payload: buildGenericCsvPayload(run),
      targetRegulator: 'SARS',
      submitEndpointHint: 'https://secure.sarsefiling.co.za',
      instructions:
        'Upload under SARS eFiling. Declare on the MPR1/MPR2/MPR3 mineral-royalty returns.',
    };
  },
};

const southAfricaPaymentRails: PaymentRailPort = {
  listRails() {
    return Object.freeze([
      { id: 'payfast', label: 'PayFast', kind: 'card' as const, currency: 'ZAR', minAmountMinorUnits: 500, settlementLagHours: 24, integrationAdapterHint: 'PAYFAST', supportsCollection: true, supportsDisbursement: false },
      { id: 'eft_za', label: 'EFT (SA banks)', kind: 'bank-transfer' as const, currency: 'ZAR', minAmountMinorUnits: 100, settlementLagHours: 24, integrationAdapterHint: 'EFT_ZA', supportsCollection: true, supportsDisbursement: true },
      { id: 'payshap', label: 'PayShap (instant)', kind: 'bank-transfer' as const, currency: 'ZAR', minAmountMinorUnits: 100, settlementLagHours: 1, integrationAdapterHint: 'PAYSHAP', supportsCollection: true, supportsDisbursement: true },
    ]);
  },
};

const southAfricaCounterpartyScreening: CounterpartyScreeningPort = {
  async lookupBureau(_identityDocument, _country, consentToken) {
    if (!consentToken) return buildStubBureauResult('TPN_ZA', ['CONSENT_TOKEN_INVALID']);
    // Follow-up ph-Z-global (#33): wire TPN / Experian ZA.
    return buildStubBureauResult('TPN_ZA');
  },
};

const southAfricaMiningLaw: MiningLawPort = {
  requiredClauses(_operationKind) {
    return Object.freeze([
      { id: 'parties', label: 'Parties', mandatory: true, citation: 'Mineral and Petroleum Resources Development Act 28 of 2002 §5.' },
      { id: 'site', label: 'Licensed area', mandatory: true, citation: 'Mineral and Petroleum Resources Development Act 28 of 2002 §5.' },
      { id: 'royalty-rate', label: 'Royalty/payment rate and frequency in ZAR', mandatory: true, citation: 'Mineral and Petroleum Resources Royalty Act 28 of 2008.' },
      { id: 'bond', label: 'Performance bond handling and interest', mandatory: true, citation: 'MPRDA 28 of 2002 §41 (financial provision).' },
      { id: 'rehabilitation', label: 'Environmental rehabilitation / closure plan clause', mandatory: true, citation: 'MPRDA 28 of 2002 §41; NEMA.' },
    ]);
  },
  noticeWindowDays(reason) {
    switch (reason) {
      case 'royalty-default': return 20; // 20 business days
      case 'licence-expiry':
      case 'renewal-non-continuation': return 20;
      case 'state-repossession': return 60;
      case 'breach-of-condition': return 20;
      case 'illegal-mining':
      case 'environmental-breach': return 14;
      default: return null;
    }
  },
  bondCapMultiple(regime) {
    if (regime === 'industrial') return { maxMonthsOfRoyalty: 3, citation: 'Market norm.' };
    return { maxMonthsOfRoyalty: 2, citation: 'MPRDA 28 of 2002 — customary financial-provision cap.' };
  },
  royaltyEscalationCap(_regime) {
    return { citation: 'No statutory cap; the Mineral Resources regulator may invalidate unreasonable escalations.' };
  },
};

export const southAfricaPlugin: CountryPlugin = {
  countryCode: 'ZA',
  countryName: 'South Africa',
  currencyCode: 'ZAR',
  currencySymbol: 'R',
  phoneCountryCode: '27',
  normalizePhone: buildPhoneNormalizer({ dialingCode: '27', trunkPrefix: '0' }),
  kycProviders: [
    {
      id: 'home-affairs',
      name: 'Department of Home Affairs',
      kind: 'national-id',
      envPrefix: 'HOME_AFFAIRS',
      idFormat: /^\d{13}$/,
    },
    {
      id: 'cipc',
      name: 'Companies and Intellectual Property Commission',
      kind: 'business-registry',
      envPrefix: 'CIPC',
    },
    {
      id: 'sars',
      name: 'South African Revenue Service',
      kind: 'tax-authority',
      envPrefix: 'SARS',
      idFormat: /^\d{10}$/,
    },
    {
      id: 'dmre',
      name: 'Department of Mineral Resources and Energy',
      kind: 'credit-bureau',
      envPrefix: 'DMRE',
    },
  ],
  paymentGateways: [
    {
      id: 'payfast',
      name: 'PayFast',
      kind: 'card',
      envPrefix: 'PAYFAST',
    },
    {
      id: 'eft',
      name: 'EFT (SA bank rail)',
      kind: 'bank-rail',
      envPrefix: 'EFT_ZA',
    },
  ],
  compliance: {
    minBondMonths: 1,
    maxBondMonths: 2,
    noticePeriodDays: 20,
    minimumTermMonths: 1,
    subSupplyConsent: 'consent-required',
    lateFeeCapRate: null,
    bondReturnDays: 14,
  },
  documentTemplates: [
    {
      id: 'offtake-agreement',
      name: 'Mineral Offtake Agreement (ZA)',
      templatePath: 'za/offtake-agreement.hbs',
      locale: 'en-ZA',
    },
    {
      id: 'notice-of-suspension',
      name: 'Notice of Licence Suspension (ZA)',
      templatePath: 'za/notice-of-suspension.hbs',
      locale: 'en-ZA',
    },
  ],
  taxRegime: southAfricaTaxRegime,
  taxFiling: southAfricaTaxFiling,
  paymentRails: southAfricaPaymentRails,
  counterpartyScreening: southAfricaCounterpartyScreening,
  miningLaw: southAfricaMiningLaw,
};

/**
 * Uganda (UG) mining-compliance plugin.
 *
 * Based on the Mining and Minerals Act 2022 and URA's royalty / withholding
 * framework. Mobile-money prefixes follow services/payments MTN adapter.
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

// --- Uganda port implementations --------------------------------------------

/** Uganda mineral royalty — 5% on gross market value of precious metals. */
const ugandaTaxRegime: TaxRegimePort = {
  calculateWithholding(grossValueMinorUnits, _currency, _period) {
    return flatRateWithholding(
      grossValueMinorUnits,
      5,
      'URA-ROYALTY',
      'Uganda mineral royalty — 5% on gross market value of precious metals (Mining and Minerals Act 2022).'
    );
  },
};

const ugandaTaxFiling: TaxFilingPort = {
  prepareFiling(run, _operatorProfile, _period) {
    return {
      filingFormat: 'csv',
      payload: buildGenericCsvPayload(run),
      targetRegulator: 'URA',
      submitEndpointHint: 'https://www.ura.go.ug',
      instructions: 'Upload under URA mineral-royalty return; monthly filing.',
    };
  },
};

const ugandaPaymentRails: PaymentRailPort = {
  listRails() {
    return Object.freeze([
      { id: 'mtn_momo', label: 'MTN Mobile Money (UG)', kind: 'mobile-money' as const, currency: 'UGX', minAmountMinorUnits: 500, settlementLagHours: 2, integrationAdapterHint: 'MTN_MOMO', supportsCollection: true, supportsDisbursement: true },
      { id: 'airtelmoney_ug', label: 'Airtel Money (UG)', kind: 'mobile-money' as const, currency: 'UGX', minAmountMinorUnits: 500, settlementLagHours: 4, integrationAdapterHint: 'AIRTELMONEY', supportsCollection: true, supportsDisbursement: true },
      { id: 'bank_ug', label: 'Bank transfer (UG)', kind: 'bank-transfer' as const, currency: 'UGX', minAmountMinorUnits: 1000, settlementLagHours: 24, integrationAdapterHint: null, supportsCollection: true, supportsDisbursement: true },
    ]);
  },
};

const ugandaCounterpartyScreening: CounterpartyScreeningPort = {
  async lookupBureau(_identityDocument, _country, consentToken) {
    if (!consentToken) return buildStubBureauResult('CRB_UG', ['CONSENT_TOKEN_INVALID']);
    // Follow-up ph-Z-global (#33): wire CRB UG adapter when available.
    return buildStubBureauResult('CRB_UG');
  },
};

const ugandaMiningLaw: MiningLawPort = {
  requiredClauses(_operationKind) {
    return Object.freeze([
      { id: 'parties', label: 'Parties', mandatory: true, citation: 'Mining and Minerals Act 2022 §5.' },
      { id: 'site', label: 'Licensed-area description', mandatory: true, citation: 'Mining and Minerals Act 2022 §5.' },
      { id: 'royalty-rate', label: 'Royalty/payment rate and frequency in UGX', mandatory: true, citation: 'Mining and Minerals Act 2022 §7.' },
      { id: 'bond', label: 'Performance bond not exceeding 3 months royalty', mandatory: true, citation: 'Mining and Minerals Act 2022 §13.' },
    ]);
  },
  noticeWindowDays(reason) {
    switch (reason) {
      case 'royalty-default': return 14;
      case 'licence-expiry':
      case 'renewal-non-continuation': return 60;
      case 'state-repossession': return 90;
      case 'breach-of-condition': return 30;
      case 'illegal-mining':
      case 'environmental-breach': return 7;
      default: return null;
    }
  },
  bondCapMultiple(regime) {
    if (regime === 'industrial') return { maxMonthsOfRoyalty: 6, citation: 'Market norm.' };
    return { maxMonthsOfRoyalty: 3, citation: 'Mining and Minerals Act 2022 §13.' };
  },
  royaltyEscalationCap(_regime) {
    return {
      pctPerAnnum: 10,
      citation: 'Mining and Minerals Act 2022 §13(5) — 10% cap per annum.',
    };
  },
};

export const ugandaPlugin: CountryPlugin = {
  countryCode: 'UG',
  countryName: 'Uganda',
  currencyCode: 'UGX',
  currencySymbol: 'USh',
  phoneCountryCode: '256',
  normalizePhone: buildPhoneNormalizer({ dialingCode: '256', trunkPrefix: '0' }),
  kycProviders: [
    {
      id: 'nira',
      name: 'National Identification and Registration Authority',
      kind: 'national-id',
      envPrefix: 'NIRA',
      idFormat: /^[A-Z0-9]{14}$/,
    },
    {
      id: 'ursb',
      name: 'Uganda Registration Services Bureau',
      kind: 'business-registry',
      envPrefix: 'URSB',
    },
    {
      id: 'ura',
      name: 'Uganda Revenue Authority',
      kind: 'tax-authority',
      envPrefix: 'URA',
      idFormat: /^\d{10}$/,
    },
  ],
  paymentGateways: [
    {
      id: 'mtn_momo',
      name: 'MTN Mobile Money (UG)',
      kind: 'mobile-money',
      envPrefix: 'MTN_MOMO',
    },
    {
      id: 'airtelmoney_ug',
      name: 'Airtel Money (UG)',
      kind: 'mobile-money',
      envPrefix: 'AIRTELMONEY',
    },
  ],
  compliance: {
    minBondMonths: 1,
    maxBondMonths: 3,
    noticePeriodDays: 60,
    minimumTermMonths: 6,
    subSupplyConsent: 'consent-required',
    lateFeeCapRate: null,
    bondReturnDays: 30,
  },
  documentTemplates: [
    {
      id: 'offtake-agreement',
      name: 'Mineral Offtake Agreement (UG)',
      templatePath: 'ug/offtake-agreement.hbs',
      locale: 'en-UG',
    },
    {
      id: 'notice-of-suspension',
      name: 'Notice of Licence Suspension (UG)',
      templatePath: 'ug/notice-of-suspension.hbs',
      locale: 'en-UG',
    },
  ],
  taxRegime: ugandaTaxRegime,
  taxFiling: ugandaTaxFiling,
  paymentRails: ugandaPaymentRails,
  counterpartyScreening: ugandaCounterpartyScreening,
  miningLaw: ugandaMiningLaw,
};

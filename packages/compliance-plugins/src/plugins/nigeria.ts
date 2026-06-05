/**
 * Nigeria (NG) mining-compliance plugin.
 *
 * Defaults pull from the Nigerian Minerals and Mining Act 2007 (the federal
 * baseline); state-level variants can override via a future sub-plugin pattern
 * similar to the US plugin's state hook.
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

// --- Nigeria port implementations -------------------------------------------

/** Nigeria mineral royalty — 5% on gross value (Minerals and Mining Act 2007 §33). */
const nigeriaTaxRegime: TaxRegimePort = {
  calculateWithholding(grossValueMinorUnits, _currency, _period) {
    return flatRateWithholding(
      grossValueMinorUnits,
      5,
      'NG-MINERAL-ROYALTY',
      'Nigeria mineral royalty — 5% on gross value of minerals won (Nigerian Minerals and Mining Act 2007 §33).'
    );
  },
};

const nigeriaTaxFiling: TaxFilingPort = {
  prepareFiling(run, _operatorProfile, _period) {
    return {
      filingFormat: 'csv',
      payload: buildGenericCsvPayload(run),
      targetRegulator: 'FIRS',
      submitEndpointHint: 'https://taxpromax.firs.gov.ng',
      instructions:
        'Submit the royalty schedule via TaxPro-Max under Mineral Royalty. ' +
        'Remit by the 21st of the following month.',
    };
  },
};

const nigeriaPaymentRails: PaymentRailPort = {
  listRails() {
    return Object.freeze([
      { id: 'paystack', label: 'Paystack', kind: 'card' as const, currency: 'NGN', minAmountMinorUnits: 10000, settlementLagHours: 24, integrationAdapterHint: 'PAYSTACK', supportsCollection: true, supportsDisbursement: true },
      { id: 'flutterwave', label: 'Flutterwave', kind: 'card' as const, currency: 'NGN', minAmountMinorUnits: 10000, settlementLagHours: 24, integrationAdapterHint: 'FLUTTERWAVE', supportsCollection: true, supportsDisbursement: true },
      { id: 'nibss', label: 'NIBSS Instant Payment', kind: 'bank-transfer' as const, currency: 'NGN', minAmountMinorUnits: 10000, settlementLagHours: 1, integrationAdapterHint: 'NIBSS', supportsCollection: true, supportsDisbursement: true },
    ]);
  },
};

const nigeriaCounterpartyScreening: CounterpartyScreeningPort = {
  async lookupBureau(identityDocument, _country, consentToken) {
    if (!consentToken) return buildStubBureauResult('CRC_CREDIT_BUREAU_NG', ['CONSENT_TOKEN_INVALID']);
    void identityDocument;
    // Follow-up ph-Z-global (#33): wire CRC Credit Bureau NG when env CRC_NG_KEY set.
    return buildStubBureauResult('CRC_CREDIT_BUREAU_NG');
  },
};

const nigeriaMiningLaw: MiningLawPort = {
  requiredClauses(_operationKind) {
    return Object.freeze([
      { id: 'parties', label: 'Parties', mandatory: true, citation: 'Nigerian Minerals and Mining Act 2007 §3.' },
      { id: 'site', label: 'Licensed area', mandatory: true, citation: 'Nigerian Minerals and Mining Act 2007 §3.' },
      { id: 'royalty-rate', label: 'Royalty/payment rate and frequency in NGN', mandatory: true, citation: 'Nigerian Minerals and Mining Act 2007 §33.' },
      { id: 'stamp-duty', label: 'Evidence of stamp duty payment', mandatory: true, citation: 'Stamp Duties Act.' },
    ]);
  },
  noticeWindowDays(reason) {
    switch (reason) {
      case 'royalty-default': return 7; // 7 days notice on default
      case 'licence-expiry':
      case 'renewal-non-continuation': return 180; // Annual licence
      case 'state-repossession': return 180;
      case 'breach-of-condition': return 30;
      case 'illegal-mining':
      case 'environmental-breach': return 7;
      default: return null;
    }
  },
  bondCapMultiple(regime) {
    if (regime === 'industrial') return { maxMonthsOfRoyalty: 24, citation: 'Market norm — 1-2 years upfront.' };
    return { maxMonthsOfRoyalty: 12, citation: 'Nigerian Minerals and Mining Act 2007 — no more than one year upfront.' };
  },
  royaltyEscalationCap(_regime) {
    return { citation: 'No statutory cap; operator may petition the Mining Cadastre Office if escalation arbitrary.' };
  },
};

export const nigeriaPlugin: CountryPlugin = {
  countryCode: 'NG',
  countryName: 'Nigeria',
  currencyCode: 'NGN',
  currencySymbol: '\u20A6',
  phoneCountryCode: '234',
  normalizePhone: buildPhoneNormalizer({ dialingCode: '234', trunkPrefix: '0' }),
  kycProviders: [
    {
      id: 'nimc',
      name: 'National Identity Management Commission',
      kind: 'national-id',
      envPrefix: 'NIMC',
      idFormat: /^\d{11}$/,
    },
    {
      id: 'cac',
      name: 'Corporate Affairs Commission',
      kind: 'business-registry',
      envPrefix: 'CAC',
    },
    {
      id: 'firs',
      name: 'Federal Inland Revenue Service',
      kind: 'tax-authority',
      envPrefix: 'FIRS',
    },
    {
      id: 'cbn',
      name: 'Central Bank of Nigeria (BVN)',
      kind: 'credit-bureau',
      envPrefix: 'CBN',
      idFormat: /^\d{11}$/,
    },
  ],
  paymentGateways: [
    {
      id: 'paystack',
      name: 'Paystack',
      kind: 'card',
      envPrefix: 'PAYSTACK',
    },
    {
      id: 'flutterwave',
      name: 'Flutterwave',
      kind: 'card',
      envPrefix: 'FLUTTERWAVE',
    },
    {
      id: 'nibss',
      name: 'NIBSS Instant Payment',
      kind: 'bank-rail',
      envPrefix: 'NIBSS',
    },
  ],
  compliance: {
    minBondMonths: 1,
    maxBondMonths: 12,
    noticePeriodDays: 180,
    minimumTermMonths: 12,
    subSupplyConsent: 'consent-required',
    lateFeeCapRate: null,
    bondReturnDays: 30,
  },
  documentTemplates: [
    {
      id: 'offtake-agreement',
      name: 'Mineral Offtake Agreement (NG)',
      templatePath: 'ng/offtake-agreement.hbs',
      locale: 'en-NG',
    },
    {
      id: 'notice-of-suspension',
      name: 'Licence Suspension Notice (NG)',
      templatePath: 'ng/notice-of-suspension.hbs',
      locale: 'en-NG',
    },
  ],
  taxRegime: nigeriaTaxRegime,
  taxFiling: nigeriaTaxFiling,
  paymentRails: nigeriaPaymentRails,
  counterpartyScreening: nigeriaCounterpartyScreening,
  miningLaw: nigeriaMiningLaw,
};

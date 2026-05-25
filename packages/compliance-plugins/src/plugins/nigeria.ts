/**
 * Nigeria (NG) compliance plugin.
 *
 * Defaults pull from the Tenancy Law of Lagos State (most common baseline);
 * state-level variants can override via a future sub-plugin pattern similar
 * to the US plugin's state hook.
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
  type TenantScreeningPort,
} from '../ports/tenant-screening.port.js';
import type { LeaseLawPort } from '../ports/lease-law.port.js';

// --- Nigeria port implementations -------------------------------------------

/** FIRS rental WHT — 10% on gross rent (CITA §78). */
const nigeriaTaxRegime: TaxRegimePort = {
  calculateWithholding(grossRentMinorUnits, _currency, _period) {
    return flatRateWithholding(
      grossRentMinorUnits,
      10,
      'FIRS-WHT-RENT',
      'FIRS withholding tax on rent — 10% on gross (Companies Income Tax Act §78).'
    );
  },
};

const nigeriaTaxFiling: TaxFilingPort = {
  prepareFiling(run, _tenantProfile, _period) {
    return {
      filingFormat: 'csv',
      payload: buildGenericCsvPayload(run),
      targetRegulator: 'FIRS',
      submitEndpointHint: 'https://taxpromax.firs.gov.ng',
      instructions:
        'Submit WHT schedule via TaxPro-Max under Withholding Tax — Rent. ' +
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

const nigeriaTenantScreening: TenantScreeningPort = {
  async lookupBureau(identityDocument, _country, consentToken) {
    if (!consentToken) return buildStubBureauResult('CRC_CREDIT_BUREAU_NG', ['CONSENT_TOKEN_INVALID']);
    void identityDocument;
    // Follow-up ph-Z-global (Docs/TODO_BACKLOG.md): wire CRC Credit Bureau NG when env CRC_NG_KEY set.
    return buildStubBureauResult('CRC_CREDIT_BUREAU_NG');
  },
};

const nigeriaLeaseLaw: LeaseLawPort = {
  requiredClauses(_leaseKind) {
    return Object.freeze([
      { id: 'parties', label: 'Parties', mandatory: true, citation: 'Tenancy Law of Lagos State 2011 §3.' },
      { id: 'premises', label: 'Premises', mandatory: true, citation: 'Tenancy Law of Lagos State 2011 §3.' },
      { id: 'rent-amount', label: 'Rent amount and frequency in NGN', mandatory: true, citation: 'Tenancy Law of Lagos State 2011 §7.' },
      { id: 'stamp-duty', label: 'Evidence of stamp duty payment', mandatory: true, citation: 'Stamp Duties Act.' },
    ]);
  },
  noticeWindowDays(reason) {
    switch (reason) {
      case 'non-payment': return 7; // Lagos — 7 days notice on default
      case 'end-of-term':
      case 'renewal-non-continuation': return 180; // Yearly tenancy
      case 'landlord-repossession': return 180;
      case 'breach-of-covenant': return 30;
      case 'illegal-use':
      case 'nuisance': return 7;
      default: return null;
    }
  },
  depositCapMultiple(regime) {
    if (regime === 'commercial') return { maxMonthsOfRent: 24, citation: 'Market norm — 1-2 years upfront.' };
    return { maxMonthsOfRent: 12, citation: 'Tenancy Law of Lagos State 2011 §4(3) — no more than one year upfront.' };
  },
  rentIncreaseCap(_regime) {
    return { citation: 'No statutory cap; tenant may petition court if increase arbitrary (§37 Tenancy Law Lagos).' };
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
    minDepositMonths: 1,
    maxDepositMonths: 12,
    noticePeriodDays: 180,
    minimumLeaseMonths: 12,
    subleaseConsent: 'consent-required',
    lateFeeCapRate: null,
    depositReturnDays: 30,
  },
  documentTemplates: [
    {
      id: 'lease-agreement',
      name: 'Tenancy Agreement (NG)',
      templatePath: 'ng/lease-agreement.hbs',
      locale: 'en-NG',
    },
    {
      id: 'notice-of-termination',
      name: 'Quit Notice (NG)',
      templatePath: 'ng/notice-of-termination.hbs',
      locale: 'en-NG',
    },
  ],
  taxRegime: nigeriaTaxRegime,
  taxFiling: nigeriaTaxFiling,
  paymentRails: nigeriaPaymentRails,
  tenantScreening: nigeriaTenantScreening,
  leaseLaw: nigeriaLeaseLaw,
};

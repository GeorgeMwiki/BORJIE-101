/**
 * Tanzania (TZ) compliance plugin.
 *
 * Preserves every piece of Tanzania-specific logic that used to live inline
 * in identity / payments / tax services. Env-var prefixes match the existing
 * `.env` patterns — real credentials stay in the environment, never in code.
 *
 * Statutory defaults (notice periods, deposit caps) sourced from Tanzania's
 * Land (Landlord and Tenant) Act. Confirm with counsel before going live.
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

// --- Tanzania port implementations ------------------------------------------

/** TRA rental income: 10% withholding on gross for individual landlords. */
const tanzaniaTaxRegime: TaxRegimePort = {
  calculateWithholding(grossRentMinorUnits, _currency, _period) {
    return flatRateWithholding(
      grossRentMinorUnits,
      10,
      'TRA-WHT-RENT',
      'TRA rental-income withholding — 10% on gross rent (Income Tax Act §83).'
    );
  },
};

const tanzaniaTaxFiling: TaxFilingPort = {
  prepareFiling(run, _tenantProfile, _period) {
    return {
      filingFormat: 'csv',
      payload: buildGenericCsvPayload(run),
      targetRegulator: 'TRA',
      submitEndpointHint: 'https://taxportal.tra.go.tz',
      instructions:
        'Upload the CSV to the TRA Tax Portal under Withholding Tax on Rent. ' +
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

const tanzaniaTenantScreening: TenantScreeningPort = {
  async lookupBureau(identityDocument, _country, consentToken) {
    if (!consentToken) {
      return buildStubBureauResult('CRB_TZ', ['CONSENT_TOKEN_INVALID']);
    }
    void identityDocument;
    // Follow-up ph-Z-global (Docs/TODO_BACKLOG.md): wire real CRB TZ adapter when env CRB_TZ_KEY set.
    return buildStubBureauResult('CRB_TZ');
  },
};

const tanzaniaLeaseLaw: LeaseLawPort = {
  requiredClauses(_leaseKind) {
    return Object.freeze([
      { id: 'parties', label: 'Parties', mandatory: true, citation: 'Land (Landlord and Tenant) Act §29.' },
      { id: 'premises', label: 'Description of premises', mandatory: true, citation: 'Land (Landlord and Tenant) Act §29.' },
      { id: 'rent-amount', label: 'Rent amount and frequency in TZS', mandatory: true, citation: 'Land (Landlord and Tenant) Act §30.' },
      { id: 'tra-tin', label: "Landlord's TRA TIN disclosure", mandatory: true, citation: 'TRA withholding-agent requirement.' },
    ]);
  },
  noticeWindowDays(reason) {
    switch (reason) {
      case 'non-payment': return 30;
      case 'end-of-term':
      case 'renewal-non-continuation': return 90;
      case 'landlord-repossession': return 180;
      case 'breach-of-covenant': return 30;
      case 'illegal-use':
      case 'nuisance': return 14;
      default: return null;
    }
  },
  depositCapMultiple(regime) {
    if (regime === 'commercial') return { maxMonthsOfRent: 12, citation: 'Market norm.' };
    return { maxMonthsOfRent: 6, citation: 'Land (Landlord and Tenant) Act §32.' };
  },
  rentIncreaseCap(_regime) {
    return { citation: 'No statutory cap — arbitrated by Housing Tribunal on dispute.' };
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
    minDepositMonths: 1,
    maxDepositMonths: 6,
    noticePeriodDays: 90,
    minimumLeaseMonths: 6,
    subleaseConsent: 'consent-required',
    lateFeeCapRate: null,
    depositReturnDays: 30,
  },
  documentTemplates: [
    {
      id: 'lease-agreement',
      name: 'Residential Lease Agreement (TZ)',
      templatePath: 'tz/lease-agreement.hbs',
      locale: 'sw-TZ',
    },
    {
      id: 'notice-of-termination',
      name: 'Notice of Termination (TZ)',
      templatePath: 'tz/notice-of-termination.hbs',
      locale: 'sw-TZ',
    },
  ],
  taxRegime: tanzaniaTaxRegime,
  taxFiling: tanzaniaTaxFiling,
  paymentRails: tanzaniaPaymentRails,
  tenantScreening: tanzaniaTenantScreening,
  leaseLaw: tanzaniaLeaseLaw,
};

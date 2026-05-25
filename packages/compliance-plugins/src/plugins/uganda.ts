/**
 * Uganda (UG) compliance plugin.
 *
 * Based on the Landlord and Tenant Act 2022 and URA's rental income tax
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
  type TenantScreeningPort,
} from '../ports/tenant-screening.port.js';
import type { LeaseLawPort } from '../ports/lease-law.port.js';

// --- Uganda port implementations --------------------------------------------

/** URA rental tax — 12% on gross above UGX 2.82M threshold for individuals. */
const ugandaTaxRegime: TaxRegimePort = {
  calculateWithholding(grossRentMinorUnits, _currency, _period) {
    return flatRateWithholding(
      grossRentMinorUnits,
      12,
      'URA-RENTAL',
      'URA Rental Tax — 12% on gross above UGX 2.82M/yr (Income Tax (Amendment) Act 2023).'
    );
  },
};

const ugandaTaxFiling: TaxFilingPort = {
  prepareFiling(run, _tenantProfile, _period) {
    return {
      filingFormat: 'csv',
      payload: buildGenericCsvPayload(run),
      targetRegulator: 'URA',
      submitEndpointHint: 'https://www.ura.go.ug',
      instructions: 'Upload under URA Rental Tax return; annual filing.',
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

const ugandaTenantScreening: TenantScreeningPort = {
  async lookupBureau(_identityDocument, _country, consentToken) {
    if (!consentToken) return buildStubBureauResult('CRB_UG', ['CONSENT_TOKEN_INVALID']);
    // Follow-up ph-Z-global (Docs/TODO_BACKLOG.md): wire CRB UG adapter when available.
    return buildStubBureauResult('CRB_UG');
  },
};

const ugandaLeaseLaw: LeaseLawPort = {
  requiredClauses(_leaseKind) {
    return Object.freeze([
      { id: 'parties', label: 'Parties', mandatory: true, citation: 'Landlord and Tenant Act 2022 §5.' },
      { id: 'premises', label: 'Premises description', mandatory: true, citation: 'Landlord and Tenant Act 2022 §5.' },
      { id: 'rent-amount', label: 'Rent amount and frequency in UGX', mandatory: true, citation: 'Landlord and Tenant Act 2022 §7.' },
      { id: 'deposit', label: 'Deposit not exceeding 3 months rent', mandatory: true, citation: 'Landlord and Tenant Act 2022 §13.' },
    ]);
  },
  noticeWindowDays(reason) {
    switch (reason) {
      case 'non-payment': return 14;
      case 'end-of-term':
      case 'renewal-non-continuation': return 60;
      case 'landlord-repossession': return 90;
      case 'breach-of-covenant': return 30;
      case 'illegal-use':
      case 'nuisance': return 7;
      default: return null;
    }
  },
  depositCapMultiple(regime) {
    if (regime === 'commercial') return { maxMonthsOfRent: 6, citation: 'Market norm.' };
    return { maxMonthsOfRent: 3, citation: 'Landlord and Tenant Act 2022 §13.' };
  },
  rentIncreaseCap(_regime) {
    return {
      pctPerAnnum: 10,
      citation: 'Landlord and Tenant Act 2022 §13(5) — 10% cap per annum.',
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
    minDepositMonths: 1,
    maxDepositMonths: 3,
    noticePeriodDays: 60,
    minimumLeaseMonths: 6,
    subleaseConsent: 'consent-required',
    lateFeeCapRate: null,
    depositReturnDays: 30,
  },
  documentTemplates: [
    {
      id: 'lease-agreement',
      name: 'Residential Lease Agreement (UG)',
      templatePath: 'ug/lease-agreement.hbs',
      locale: 'en-UG',
    },
    {
      id: 'notice-of-termination',
      name: 'Notice of Termination (UG)',
      templatePath: 'ug/notice-of-termination.hbs',
      locale: 'en-UG',
    },
  ],
  taxRegime: ugandaTaxRegime,
  taxFiling: ugandaTaxFiling,
  paymentRails: ugandaPaymentRails,
  tenantScreening: ugandaTenantScreening,
  leaseLaw: ugandaLeaseLaw,
};

/**
 * South Africa (ZA) compliance plugin.
 *
 * Defaults based on the Rental Housing Act 50 of 1999 and SARS requirements.
 * Rental Housing Tribunal handles disputes — surfaced as a tax-authority-
 * adjacent KYC provider so downstream UI knows the dispute channel.
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

// --- South Africa port implementations --------------------------------------

/**
 * SARS rental income is taxed as regular income for residents — no flat
 * withholding applies. Non-resident landlords are subject to 7.5%
 * provisional tax via the agent. We implement the non-resident rate
 * conservatively and flag manual configuration for residents.
 */
const southAfricaTaxRegime: TaxRegimePort = {
  calculateWithholding(grossRentMinorUnits, _currency, _period) {
    return flatRateWithholding(
      grossRentMinorUnits,
      7.5,
      'SARS-WHT-NR',
      'SARS non-resident lessor withholding — 7.5% provisional. Residents: file as ordinary income.'
    );
  },
};

const southAfricaTaxFiling: TaxFilingPort = {
  prepareFiling(run, _tenantProfile, _period) {
    return {
      filingFormat: 'csv',
      payload: buildGenericCsvPayload(run),
      targetRegulator: 'SARS',
      submitEndpointHint: 'https://secure.sarsefiling.co.za',
      instructions:
        'Upload under SARS eFiling. Residents declare in IRP6 provisional tax; non-residents: NR02/NR03.',
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

const southAfricaTenantScreening: TenantScreeningPort = {
  async lookupBureau(_identityDocument, _country, consentToken) {
    if (!consentToken) return buildStubBureauResult('TPN_ZA', ['CONSENT_TOKEN_INVALID']);
    // Follow-up ph-Z-global (Docs/TODO_BACKLOG.md): wire TPN / Experian ZA.
    return buildStubBureauResult('TPN_ZA');
  },
};

const southAfricaLeaseLaw: LeaseLawPort = {
  requiredClauses(_leaseKind) {
    return Object.freeze([
      { id: 'parties', label: 'Parties', mandatory: true, citation: 'Rental Housing Act 50 of 1999 §5.' },
      { id: 'premises', label: 'Premises', mandatory: true, citation: 'Rental Housing Act 50 of 1999 §5.' },
      { id: 'rent-amount', label: 'Rent amount and frequency in ZAR', mandatory: true, citation: 'Rental Housing Act 50 of 1999 §5(3).' },
      { id: 'deposit', label: 'Deposit handling and interest', mandatory: true, citation: 'Rental Housing Act 50 of 1999 §5(3)(d).' },
      { id: 'ingoing-outgoing-inspection', label: 'Joint ingoing/outgoing inspection clause', mandatory: true, citation: 'Rental Housing Act 50 of 1999 §5(3)(e)-(f).' },
    ]);
  },
  noticeWindowDays(reason) {
    switch (reason) {
      case 'non-payment': return 20; // CPA 20 business days
      case 'end-of-term':
      case 'renewal-non-continuation': return 20;
      case 'landlord-repossession': return 60;
      case 'breach-of-covenant': return 20;
      case 'illegal-use':
      case 'nuisance': return 14;
      default: return null;
    }
  },
  depositCapMultiple(regime) {
    if (regime === 'commercial') return { maxMonthsOfRent: 3, citation: 'Market norm.' };
    return { maxMonthsOfRent: 2, citation: 'Rental Housing Act 50 of 1999 — customary cap.' };
  },
  rentIncreaseCap(_regime) {
    return { citation: 'No statutory cap; Rental Housing Tribunal may invalidate unreasonable increases.' };
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
      id: 'rht',
      name: 'Rental Housing Tribunal',
      kind: 'credit-bureau',
      envPrefix: 'RHT',
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
    minDepositMonths: 1,
    maxDepositMonths: 2,
    noticePeriodDays: 20,
    minimumLeaseMonths: 1,
    subleaseConsent: 'consent-required',
    lateFeeCapRate: null,
    depositReturnDays: 14,
  },
  documentTemplates: [
    {
      id: 'lease-agreement',
      name: 'Residential Lease Agreement (ZA)',
      templatePath: 'za/lease-agreement.hbs',
      locale: 'en-ZA',
    },
    {
      id: 'notice-of-termination',
      name: 'Notice of Termination (ZA)',
      templatePath: 'za/notice-of-termination.hbs',
      locale: 'en-ZA',
    },
  ],
  taxRegime: southAfricaTaxRegime,
  taxFiling: southAfricaTaxFiling,
  paymentRails: southAfricaPaymentRails,
  tenantScreening: southAfricaTenantScreening,
  leaseLaw: southAfricaLeaseLaw,
};

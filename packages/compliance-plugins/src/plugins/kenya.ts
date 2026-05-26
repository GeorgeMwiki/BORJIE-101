/**
 * Kenya (KE) compliance plugin.
 *
 * Rules reflect the Distress for Rent Act, Rent Restriction Act, and KRA's
 * Monthly Rental Income (MRI) regime. Env-var prefixes follow the existing
 * services/payments mpesa-safaricom and services/identity KRA adapters.
 */

import { buildPhoneNormalizer } from '../core/phone.js';
import type { CountryPlugin } from '../core/types.js';
import {
  flatRateWithholding,
  type TaxRegimePort,
} from '../ports/tax-regime.port.js';
import {
  buildKenyaMriXmlPayload,
  type TaxFilingPort,
} from '../ports/tax-filing.port.js';
import type { PaymentRailPort } from '../ports/payment-rail.port.js';
import {
  buildStubBureauResult,
  type TenantScreeningPort,
} from '../ports/tenant-screening.port.js';
import type { LeaseLawPort } from '../ports/lease-law.port.js';

// --- Kenya port implementations ---------------------------------------------

/** KRA Monthly Rental Income (MRI) — 7.5% flat on gross residential rent. */
const kenyaTaxRegime: TaxRegimePort = {
  calculateWithholding(grossRentMinorUnits, _currency, _period) {
    return flatRateWithholding(
      grossRentMinorUnits,
      7.5,
      'KRA-MRI',
      'KRA Monthly Rental Income — 7.5% flat on gross residential rent (Kenya Finance Act 2024).'
    );
  },
};

const kenyaTaxFiling: TaxFilingPort = {
  prepareFiling(run, tenantProfile, period) {
    // Round-3 audit H21 fix — KRA iTax accepts a structured upload,
    // not free-form CSV. We produce a canonical XML payload that
    // matches the KRA MRI return shape. The submission service still
    // signs + envelopes; this is the data layer.
    return {
      filingFormat: 'xml',
      payload: buildKenyaMriXmlPayload(run, tenantProfile, period),
      targetRegulator: 'KRA',
      submitEndpointHint: 'https://itax.kra.go.ke',
      instructions:
        'Upload the signed XML envelope to the KRA iTax Monthly Rental Income return. ' +
        'File by the 20th of the month following the period.',
    };
  },
};

const kenyaPaymentRails: PaymentRailPort = {
  listRails() {
    return Object.freeze([
      {
        id: 'mpesa_ke',
        label: 'M-Pesa (Safaricom)',
        kind: 'mobile-money' as const,
        currency: 'KES',
        minAmountMinorUnits: 100,
        settlementLagHours: 2,
        integrationAdapterHint: 'MPESA',
        supportsCollection: true,
        supportsDisbursement: true,
      },
      {
        id: 'airtelmoney_ke',
        label: 'Airtel Money (KE)',
        kind: 'mobile-money' as const,
        currency: 'KES',
        minAmountMinorUnits: 100,
        settlementLagHours: 4,
        integrationAdapterHint: 'AIRTELMONEY',
        supportsCollection: true,
        supportsDisbursement: true,
      },
      {
        id: 'pesalink',
        label: 'Pesalink (inter-bank instant)',
        kind: 'bank-transfer' as const,
        currency: 'KES',
        minAmountMinorUnits: 10000,
        settlementLagHours: 2,
        integrationAdapterHint: 'PESALINK',
        supportsCollection: true,
        supportsDisbursement: true,
      },
      {
        id: 'card_ke',
        label: 'Card payment (Visa/Mastercard via Stripe)',
        kind: 'card' as const,
        currency: 'KES',
        minAmountMinorUnits: 100,
        settlementLagHours: 48,
        integrationAdapterHint: 'STRIPE',
        supportsCollection: true,
        supportsDisbursement: false,
      },
    ]);
  },
};

const kenyaTenantScreening: TenantScreeningPort = {
  async lookupBureau(identityDocument, _country, consentToken) {
    // Real CRB wire call deferred — env-gated (CRB_KE_KEY). We stub safely.
    if (!consentToken) {
      return buildStubBureauResult('CRB_KE', ['CONSENT_TOKEN_INVALID']);
    }
    // Round-3 audit H19 fix — the previous `if (process.env.CRB_KE_KEY)`
    // branch was INVERTED. Setting the env var (production config)
    // dropped callers into `BUREAU_NOT_CONFIGURED`; missing the env
    // var returned a clean stub. We now fire the
    // BUREAU_NOT_CONFIGURED reason when the env is missing — surfacing
    // the configuration gap — and reserve the empty branch for the
    // real adapter wire-up.
    if (!process.env.CRB_KE_KEY) {
      // Touch the argument so linters do not flag it unused.
      void identityDocument;
      return buildStubBureauResult('CRB_KE', ['BUREAU_NOT_CONFIGURED']);
    }
    // Follow-up ph-Z-global (#33): wire real CRB KE adapter — see services/identity
    void identityDocument;
    return buildStubBureauResult('CRB_KE');
  },
};

const kenyaLeaseLaw: LeaseLawPort = {
  requiredClauses(_leaseKind) {
    return Object.freeze([
      {
        id: 'parties',
        label: 'Names and addresses of landlord and tenant',
        mandatory: true,
        citation: 'Distress for Rent Act (Cap 293) §3.',
      },
      {
        id: 'premises',
        label: 'Description of the leased premises',
        mandatory: true,
        citation: 'Distress for Rent Act (Cap 293) §3.',
      },
      {
        id: 'rent-amount',
        label: 'Rent amount and payment frequency in KES',
        mandatory: true,
        citation: 'Rent Restriction Act (Cap 296) §5.',
      },
      {
        id: 'deposit',
        label: 'Security deposit not exceeding 3 months rent',
        mandatory: true,
        citation: 'Rent Restriction Act (Cap 296) §6.',
      },
      {
        id: 'kra-pin',
        label: "Landlord's KRA PIN disclosure",
        mandatory: true,
        citation: 'Kenya Finance Act 2024 — MRI compliance.',
      },
    ]);
  },
  noticeWindowDays(reason) {
    switch (reason) {
      case 'non-payment':
        return 14; // Distress for Rent Act notice window.
      case 'end-of-term':
      case 'renewal-non-continuation':
        return 60;
      case 'landlord-repossession':
        return 90;
      case 'breach-of-covenant':
        return 30;
      case 'illegal-use':
      case 'nuisance':
        return 7;
      default:
        return null;
    }
  },
  depositCapMultiple(regime) {
    if (regime === 'commercial') {
      return {
        maxMonthsOfRent: 6,
        citation: 'Market norm — no statutory cap for commercial lets.',
      };
    }
    return {
      maxMonthsOfRent: 3,
      citation: 'Rent Restriction Act (Cap 296) §6.',
    };
  },
  rentIncreaseCap(regime) {
    if (regime === 'residential-rent-controlled') {
      return {
        pctPerAnnum: 0,
        citation: 'Rent Restriction Act (Cap 296) — controlled tenancies.',
      };
    }
    return {
      citation:
        'No statutory cap for free-market residential — arbitrated by Rent Tribunal on dispute.',
    };
  },
};

export const kenyaPlugin: CountryPlugin = {
  countryCode: 'KE',
  countryName: 'Kenya',
  currencyCode: 'KES',
  currencySymbol: 'KSh',
  phoneCountryCode: '254',
  normalizePhone: buildPhoneNormalizer({ dialingCode: '254', trunkPrefix: '0' }),
  kycProviders: [
    {
      id: 'iprs',
      name: 'Integrated Population Registration System',
      kind: 'national-id',
      envPrefix: 'IPRS',
      idFormat: /^\d{7,9}$/,
    },
    {
      id: 'crb-ke',
      name: 'Credit Reference Bureau (KE)',
      kind: 'credit-bureau',
      envPrefix: 'CRB_KE',
    },
    {
      id: 'ecitizen',
      name: 'eCitizen Business Registry',
      kind: 'business-registry',
      envPrefix: 'ECITIZEN',
    },
    {
      id: 'kra',
      name: 'Kenya Revenue Authority (iTax)',
      kind: 'tax-authority',
      envPrefix: 'KRA',
      idFormat: /^[A-Z]\d{9}[A-Z]$/,
    },
  ],
  paymentGateways: [
    {
      id: 'mpesa_ke',
      name: 'M-Pesa (Safaricom)',
      kind: 'mobile-money',
      envPrefix: 'MPESA',
    },
    {
      id: 'airtelmoney_ke',
      name: 'Airtel Money (KE)',
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
    lateFeeCapRate: 0.1,
    depositReturnDays: 14,
  },
  documentTemplates: [
    {
      id: 'lease-agreement',
      name: 'Residential Lease Agreement (KE)',
      templatePath: 'ke/lease-agreement.hbs',
      locale: 'en-KE',
    },
    {
      id: 'notice-of-termination',
      name: 'Notice of Termination (KE)',
      templatePath: 'ke/notice-of-termination.hbs',
      locale: 'en-KE',
    },
  ],
  taxRegime: kenyaTaxRegime,
  taxFiling: kenyaTaxFiling,
  paymentRails: kenyaPaymentRails,
  tenantScreening: kenyaTenantScreening,
  leaseLaw: kenyaLeaseLaw,
};

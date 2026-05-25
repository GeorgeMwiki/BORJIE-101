/**
 * United States (US) compliance plugin.
 *
 * Landlord-tenant law is state-level in the US; this plugin exposes a
 * generic federal baseline (SSN/ITIN, IRS, FinCEN) plus a `withStateOverride`
 * helper so callers can stack state-specific rules without forking the plugin.
 *
 * The phone normalizer does NOT strip a trunk prefix — '0' is not a trunk
 * prefix in NANP; instead numbers are typed bare (e.g. '2025551234').
 */

import { buildPhoneNormalizer } from '../core/phone.js';
import type { CompliancePolicy, CountryPlugin } from '../core/types.js';
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

// --- US port implementations ------------------------------------------------

/**
 * US federal withholding on rental income: 0% for residents (report on
 * Schedule E). Non-resident aliens: 30% NRA withholding on gross rent
 * unless a treaty or ECI election applies. Default returns 0 for
 * residents with an explicit note.
 */
const unitedStatesTaxRegime: TaxRegimePort = {
  calculateWithholding(grossRentMinorUnits, _currency, _period) {
    return flatRateWithholding(
      grossRentMinorUnits,
      0,
      'IRS-1099MISC',
      'US resident lessor — 0% federal withholding; report on Schedule E. ' +
        'Non-resident aliens: 30% NRA withholding unless IRC §871(d) election.'
    );
  },
};

const unitedStatesTaxFiling: TaxFilingPort = {
  prepareFiling(run, _tenantProfile, _period) {
    return {
      filingFormat: 'csv',
      payload: buildGenericCsvPayload(run),
      targetRegulator: 'IRS',
      submitEndpointHint: 'https://www.irs.gov/filing',
      instructions:
        'CSV is the source for Form 1099-MISC (Box 1 Rents) annual filing; also feeds Schedule E.',
    };
  },
};

const unitedStatesPaymentRails: PaymentRailPort = {
  listRails() {
    return Object.freeze([
      { id: 'ach', label: 'ACH Network', kind: 'bank-transfer' as const, currency: 'USD', minAmountMinorUnits: 100, settlementLagHours: 72, integrationAdapterHint: 'ACH', supportsCollection: true, supportsDisbursement: true },
      { id: 'plaid', label: 'Plaid (bank link + ACH)', kind: 'open-banking' as const, currency: 'USD', minAmountMinorUnits: 100, settlementLagHours: 72, integrationAdapterHint: 'PLAID', supportsCollection: true, supportsDisbursement: false },
      { id: 'stripe_us', label: 'Stripe (card + ACH)', kind: 'card' as const, currency: 'USD', minAmountMinorUnits: 50, settlementLagHours: 48, integrationAdapterHint: 'STRIPE', supportsCollection: true, supportsDisbursement: true },
      { id: 'zelle', label: 'Zelle', kind: 'wallet' as const, currency: 'USD', minAmountMinorUnits: 100, settlementLagHours: 1, integrationAdapterHint: null, supportsCollection: true, supportsDisbursement: true },
    ]);
  },
};

const unitedStatesTenantScreening: TenantScreeningPort = {
  async lookupBureau(_identityDocument, _country, consentToken) {
    if (!consentToken) return buildStubBureauResult('EXPERIAN_US', ['CONSENT_TOKEN_INVALID']);
    // Follow-up ph-Z-global (Docs/TODO_BACKLOG.md): wire Experian / TransUnion / Equifax adapters; require FCRA consent.
    return buildStubBureauResult('EXPERIAN_US');
  },
};

/**
 * US lease-law is state-level. These defaults are the federal baseline;
 * call `withStateOverride` to stack state-specific rules.
 */
const unitedStatesLeaseLaw: LeaseLawPort = {
  requiredClauses(_leaseKind) {
    return Object.freeze([
      { id: 'parties', label: 'Parties', mandatory: true, citation: 'Universal contract formation.' },
      { id: 'premises', label: 'Premises description', mandatory: true, citation: 'Universal contract formation.' },
      { id: 'rent-amount', label: 'Rent amount and due date in USD', mandatory: true, citation: 'Universal contract formation.' },
      { id: 'lead-paint-disclosure', label: 'Lead-based paint disclosure (pre-1978 buildings)', mandatory: true, citation: '42 U.S.C. §4852d (Residential Lead-Based Paint Hazard Reduction Act).' },
    ]);
  },
  noticeWindowDays(reason) {
    switch (reason) {
      case 'non-payment': return 3; // Typical 3-day pay-or-quit; state-varying
      case 'end-of-term':
      case 'renewal-non-continuation': return 30;
      case 'landlord-repossession': return 60;
      case 'breach-of-covenant': return 14;
      case 'illegal-use':
      case 'nuisance': return 3;
      default: return null;
    }
  },
  depositCapMultiple(regime) {
    if (regime === 'commercial') return { maxMonthsOfRent: 6, citation: 'Market norm; no federal cap.' };
    return { maxMonthsOfRent: 2, citation: 'State-varying; NY caps at 1 month, CA at 2 months (2024).' };
  },
  rentIncreaseCap(_regime) {
    return {
      citation:
        'No federal cap; state/local rent control (NY/CA/OR) applies. Use withStateOverride to set state cap.',
    };
  },
};



const baseUsPlugin: CountryPlugin = {
  countryCode: 'US',
  countryName: 'United States',
  currencyCode: 'USD',
  currencySymbol: '$',
  phoneCountryCode: '1',
  normalizePhone: buildPhoneNormalizer({ dialingCode: '1' }),
  kycProviders: [
    {
      id: 'ssn',
      name: 'Social Security Number',
      kind: 'national-id',
      envPrefix: 'SSN',
      idFormat: /^\d{3}-?\d{2}-?\d{4}$/,
    },
    {
      id: 'itin',
      name: 'Individual Taxpayer Identification Number',
      kind: 'national-id',
      envPrefix: 'ITIN',
      idFormat: /^9\d{2}-?\d{2}-?\d{4}$/,
    },
    {
      id: 'irs',
      name: 'Internal Revenue Service',
      kind: 'tax-authority',
      envPrefix: 'IRS',
    },
    {
      id: 'fincen',
      name: 'Financial Crimes Enforcement Network',
      kind: 'credit-bureau',
      envPrefix: 'FINCEN',
    },
  ],
  paymentGateways: [
    { id: 'stripe', name: 'Stripe', kind: 'card', envPrefix: 'STRIPE' },
    { id: 'ach', name: 'ACH Network', kind: 'bank-rail', envPrefix: 'ACH' },
    { id: 'plaid', name: 'Plaid', kind: 'bank-rail', envPrefix: 'PLAID' },
  ],
  compliance: {
    // Federal baseline — many states override these via withStateOverride().
    minDepositMonths: 1,
    maxDepositMonths: 2,
    noticePeriodDays: 30,
    minimumLeaseMonths: 1,
    subleaseConsent: 'consent-required',
    lateFeeCapRate: 0.05,
    depositReturnDays: 30,
  },
  documentTemplates: [
    {
      id: 'lease-agreement',
      name: 'Residential Lease Agreement (US Federal)',
      templatePath: 'us/lease-agreement.hbs',
      locale: 'en-US',
    },
    {
      id: 'notice-of-termination',
      name: 'Notice to Quit (US Federal)',
      templatePath: 'us/notice-of-termination.hbs',
      locale: 'en-US',
    },
  ],
  taxRegime: unitedStatesTaxRegime,
  taxFiling: unitedStatesTaxFiling,
  paymentRails: unitedStatesPaymentRails,
  tenantScreening: unitedStatesTenantScreening,
  leaseLaw: unitedStatesLeaseLaw,
};

export const unitedStatesPlugin: CountryPlugin = baseUsPlugin;

/**
 * Compose a state-overridden US plugin. Consumers pass the two-letter state
 * code plus a partial `CompliancePolicy` and get back a brand-new plugin
 * with every other field untouched — no mutation of the base plugin.
 */
export function withStateOverride(
  stateCode: string,
  override: Partial<CompliancePolicy>
): CountryPlugin {
  const normalized = stateCode.trim().toUpperCase();
  if (normalized.length !== 2) {
    throw new Error(
      `withStateOverride: state code must be 2 letters, got "${stateCode}"`
    );
  }
  return {
    ...baseUsPlugin,
    countryName: `United States (${normalized})`,
    compliance: { ...baseUsPlugin.compliance, ...override },
  };
}

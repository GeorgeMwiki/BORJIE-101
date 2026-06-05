/**
 * United States (US) mining-compliance plugin.
 *
 * Mining law is state-level in the US (plus federal BLM hardrock claims on
 * public land); this plugin exposes a generic federal baseline (SSN/ITIN,
 * IRS, FinCEN) plus a `withStateOverride` helper so callers can stack
 * state-specific rules without forking the plugin.
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
  type CounterpartyScreeningPort,
} from '../ports/counterparty-screening.port.js';
import type { MiningLawPort } from '../ports/mining-law.port.js';

// --- US port implementations ------------------------------------------------

/**
 * US federal royalty/withholding on mineral proceeds: 0% federal hardrock
 * royalty on patented/unpatented claims (report income on Schedule C/E).
 * Non-resident aliens: 30% NRA withholding on gross proceeds unless a treaty
 * or ECI election applies. Default returns 0 for residents with an explicit note.
 */
const unitedStatesTaxRegime: TaxRegimePort = {
  calculateWithholding(grossValueMinorUnits, _currency, _period) {
    return flatRateWithholding(
      grossValueMinorUnits,
      0,
      'IRS-1099MISC',
      'US resident operator — 0% federal hardrock royalty; report on Schedule C/E. ' +
        'Non-resident aliens: 30% NRA withholding unless IRC §871(d) election. ' +
        'State severance taxes apply per jurisdiction.'
    );
  },
};

const unitedStatesTaxFiling: TaxFilingPort = {
  prepareFiling(run, _operatorProfile, _period) {
    return {
      filingFormat: 'csv',
      payload: buildGenericCsvPayload(run),
      targetRegulator: 'IRS',
      submitEndpointHint: 'https://www.irs.gov/filing',
      instructions:
        'CSV is the source for Form 1099-MISC (Box 2 Royalties) annual filing; also feeds Schedule C/E and state severance returns.',
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

const unitedStatesCounterpartyScreening: CounterpartyScreeningPort = {
  async lookupBureau(_identityDocument, _country, consentToken) {
    if (!consentToken) return buildStubBureauResult('EXPERIAN_US', ['CONSENT_TOKEN_INVALID']);
    // Follow-up ph-Z-global (#33): wire Experian / TransUnion / Equifax adapters; require FCRA consent.
    return buildStubBureauResult('EXPERIAN_US');
  },
};

/**
 * US mining-law is state-level (plus federal BLM hardrock claims). These
 * defaults are the federal baseline; call `withStateOverride` to stack
 * state-specific rules.
 */
const unitedStatesMiningLaw: MiningLawPort = {
  requiredClauses(_operationKind) {
    return Object.freeze([
      { id: 'parties', label: 'Parties', mandatory: true, citation: 'Universal contract formation.' },
      { id: 'site', label: 'Licensed-area / claim description', mandatory: true, citation: 'Universal contract formation; General Mining Act of 1872.' },
      { id: 'royalty-rate', label: 'Royalty/payment rate and due date in USD', mandatory: true, citation: 'Universal contract formation.' },
      { id: 'reclamation-disclosure', label: 'Reclamation / mine-closure bond disclosure (SMCRA / state)', mandatory: true, citation: '30 U.S.C. §1257 (Surface Mining Control and Reclamation Act).' },
    ]);
  },
  noticeWindowDays(reason) {
    switch (reason) {
      case 'royalty-default': return 3; // Typical 3-day cure; state-varying
      case 'licence-expiry':
      case 'renewal-non-continuation': return 30;
      case 'state-repossession': return 60;
      case 'breach-of-condition': return 14;
      case 'illegal-mining':
      case 'environmental-breach': return 3;
      default: return null;
    }
  },
  bondCapMultiple(regime) {
    if (regime === 'industrial') return { maxMonthsOfRoyalty: 6, citation: 'Market norm; no federal cap.' };
    return { maxMonthsOfRoyalty: 2, citation: 'State-varying reclamation-bond practice (2024).' };
  },
  royaltyEscalationCap(_regime) {
    return {
      citation:
        'No federal cap; state severance-tax regimes (NV/AK/WY) apply. Use withStateOverride to set state cap.',
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
    minBondMonths: 1,
    maxBondMonths: 2,
    noticePeriodDays: 30,
    minimumTermMonths: 1,
    subSupplyConsent: 'consent-required',
    lateFeeCapRate: 0.05,
    bondReturnDays: 30,
  },
  documentTemplates: [
    {
      id: 'offtake-agreement',
      name: 'Mineral Offtake Agreement (US Federal)',
      templatePath: 'us/offtake-agreement.hbs',
      locale: 'en-US',
    },
    {
      id: 'notice-of-suspension',
      name: 'Notice of Licence Suspension (US Federal)',
      templatePath: 'us/notice-of-suspension.hbs',
      locale: 'en-US',
    },
  ],
  taxRegime: unitedStatesTaxRegime,
  taxFiling: unitedStatesTaxFiling,
  paymentRails: unitedStatesPaymentRails,
  counterpartyScreening: unitedStatesCounterpartyScreening,
  miningLaw: unitedStatesMiningLaw,
};

export const unitedStatesPlugin: CountryPlugin = baseUsPlugin;

/**
 * Compose a state-overridden US plugin. Consumers pass the two-letter state
 * code plus a partial `CompliancePolicy` (e.g. state severance-bond rules)
 * and get back a brand-new plugin with every other field untouched — no
 * mutation of the base plugin.
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

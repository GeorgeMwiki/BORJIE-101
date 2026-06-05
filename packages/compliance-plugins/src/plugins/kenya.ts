/**
 * Kenya (KE) mining-compliance plugin.
 *
 * Rules reflect the Mining Act 2016, its royalty schedule, and KRA's
 * withholding regime on mineral payments. Env-var prefixes follow the existing
 * services/payments mpesa-safaricom and services/identity KRA adapters.
 */

import { buildPhoneNormalizer } from '../core/phone.js';
import type { CountryPlugin } from '../core/types.js';
import {
  flatRateWithholding,
  type TaxRegimePort,
} from '../ports/tax-regime.port.js';
import {
  buildKenyaRoyaltyXmlPayload,
  type TaxFilingPort,
} from '../ports/tax-filing.port.js';
import type { PaymentRailPort } from '../ports/payment-rail.port.js';
import {
  buildStubBureauResult,
  type CounterpartyScreeningPort,
} from '../ports/counterparty-screening.port.js';
import type { MiningLawPort } from '../ports/mining-law.port.js';

// --- Kenya port implementations ---------------------------------------------

/** KRA withholding on mineral payments — 5% on gross mineral value. */
const kenyaTaxRegime: TaxRegimePort = {
  calculateWithholding(grossValueMinorUnits, _currency, _period) {
    return flatRateWithholding(
      grossValueMinorUnits,
      5,
      'KRA-WHT-MINERAL',
      'KRA withholding on mineral payments — 5% on gross mineral value (Income Tax Act, Third Schedule).'
    );
  },
};

const kenyaTaxFiling: TaxFilingPort = {
  prepareFiling(run, operatorProfile, period) {
    // Round-3 audit H21 fix — the Kenya royalty return accepts a structured
    // upload, not free-form CSV. We produce a canonical XML payload that
    // matches the mineral-royalty return shape. The submission service still
    // signs + envelopes; this is the data layer.
    return {
      filingFormat: 'xml',
      payload: buildKenyaRoyaltyXmlPayload(run, operatorProfile, period),
      targetRegulator: 'KRA',
      submitEndpointHint: 'https://itax.kra.go.ke',
      instructions:
        'Upload the signed XML envelope to the KRA iTax mineral-payment withholding return. ' +
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

const kenyaCounterpartyScreening: CounterpartyScreeningPort = {
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

const kenyaMiningLaw: MiningLawPort = {
  requiredClauses(_operationKind) {
    return Object.freeze([
      {
        id: 'parties',
        label: 'Names and addresses of owner and counterparty',
        mandatory: true,
        citation: 'Mining Act 2016 §117 (mineral dealings).',
      },
      {
        id: 'site',
        label: 'Description of the licensed mining area',
        mandatory: true,
        citation: 'Mining Act 2016 §117.',
      },
      {
        id: 'royalty-rate',
        label: 'Royalty/payment rate and frequency in KES',
        mandatory: true,
        citation: 'Mining Act 2016 §183 (royalties).',
      },
      {
        id: 'bond',
        label: 'Performance bond not exceeding 3 months royalty',
        mandatory: true,
        citation: 'Mining (Licence) Regulations 2017.',
      },
      {
        id: 'kra-pin',
        label: "Operator's KRA PIN disclosure",
        mandatory: true,
        citation: 'Income Tax Act — mineral-payment withholding compliance.',
      },
    ]);
  },
  noticeWindowDays(reason) {
    switch (reason) {
      case 'royalty-default':
        return 14; // Royalty-default notice window.
      case 'licence-expiry':
      case 'renewal-non-continuation':
        return 60;
      case 'state-repossession':
        return 90;
      case 'breach-of-condition':
        return 30;
      case 'illegal-mining':
      case 'environmental-breach':
        return 7;
      default:
        return null;
    }
  },
  bondCapMultiple(regime) {
    if (regime === 'industrial') {
      return {
        maxMonthsOfRoyalty: 6,
        citation: 'Market norm — no statutory cap for industrial (ML) operations.',
      };
    }
    return {
      maxMonthsOfRoyalty: 3,
      citation: 'Mining (Licence) Regulations 2017.',
    };
  },
  royaltyEscalationCap(regime) {
    if (regime === 'artisanal-controlled') {
      return {
        pctPerAnnum: 0,
        citation: 'Mining Act 2016 — cooperative-managed artisanal areas.',
      };
    }
    return {
      citation:
        'No statutory cap for free-market royalties — arbitrated by the Mineral Rights Board on dispute.',
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
    minBondMonths: 1,
    maxBondMonths: 3,
    noticePeriodDays: 60,
    minimumTermMonths: 6,
    subSupplyConsent: 'consent-required',
    lateFeeCapRate: 0.1,
    bondReturnDays: 14,
  },
  documentTemplates: [
    {
      id: 'offtake-agreement',
      name: 'Mineral Offtake Agreement (KE)',
      templatePath: 'ke/offtake-agreement.hbs',
      locale: 'en-KE',
    },
    {
      id: 'notice-of-suspension',
      name: 'Notice of Licence Suspension (KE)',
      templatePath: 'ke/notice-of-suspension.hbs',
      locale: 'en-KE',
    },
  ],
  taxRegime: kenyaTaxRegime,
  taxFiling: kenyaTaxFiling,
  paymentRails: kenyaPaymentRails,
  counterpartyScreening: kenyaCounterpartyScreening,
  miningLaw: kenyaMiningLaw,
};

/**
 * Mining-TZ workflows (Wave VP-1).
 *
 * Six recurring obligations + opportunities Mr. Mwikila tracks for a
 * live mining-TZ tenant:
 *
 *   1. TRA Monthly VAT Filing            — monthly, due 20th
 *   2. Tumemadini Annual Royalty Filing  — annual, fiscal year end +31d
 *   3. NEMC EIA Submission               — event-driven, trigger +90d
 *   4. BoT Gold-Window FX Quarterly      — quarterly, quarter end +30d
 *   5. OSHA-TZ Safety Audit              — annual, anniversary
 *   6. Buyer KYC Verification            — event-driven (12-month refresh)
 *
 * Each workflow ships a frozen `VerticalWorkflowDefinition` with
 * provenance citation (URL + title + accessedAt). Citations source:
 *
 *   - TRA VAT Guidance        https://www.tra.go.tz/index.php/value-added-tax-vat   (2026-05-27)
 *   - Tumemadini (Mining Comm)https://www.madini.go.tz                              (2026-05-27)
 *   - NEMC EIA Framework      https://www.nemc.or.tz                                (2026-05-27)
 *   - BoT Gold Window         https://www.bot.go.tz                                 (2026-05-27)
 *   - Mining Act 2010 amend.  https://www.parliament.go.tz/polis/uploads/bills/acts/1454475553-The%20Mining%20Act,%202010.pdf  (2026-05-27)
 *   - OSHA-TZ                 https://www.osha.go.tz                                (2026-05-27)
 *   - FATF Precious-Minerals  https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Risk-based-approach-precious-stones.html  (2026-05-27)
 *
 * @module @borjie/vertical-profile-mining-tz/workflows
 */

import type {
  Citation,
  VerticalWorkflowDefinition,
  WorkflowContractShape,
} from '@borjie/vertical-profiles';

const ACCESSED = '2026-05-27';

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

const TRA_VAT_CITATION: Citation = Object.freeze({
  url: 'https://www.tra.go.tz/index.php/value-added-tax-vat',
  title: 'Tanzania Revenue Authority — Value Added Tax (VAT) Guidance',
  accessedAt: ACCESSED,
});

const TUMEMADINI_CITATION: Citation = Object.freeze({
  url: 'https://www.madini.go.tz',
  title: 'Tume ya Madini (Mining Commission) — Royalty Filings Portal',
  accessedAt: ACCESSED,
});

const MINING_ACT_CITATION: Citation = Object.freeze({
  url: 'https://www.parliament.go.tz/polis/uploads/bills/acts/1454475553-The%20Mining%20Act,%202010.pdf',
  title: 'Mining Act 2010 (as amended 2017) — Section 86 Royalty Rates',
  accessedAt: ACCESSED,
});

const NEMC_CITATION: Citation = Object.freeze({
  url: 'https://www.nemc.or.tz',
  title: 'National Environment Management Council — EIA Framework (EMA 2004)',
  accessedAt: ACCESSED,
});

const BOT_CITATION: Citation = Object.freeze({
  url: 'https://www.bot.go.tz',
  title: 'Bank of Tanzania — Gold Window Directive + FX Reporting',
  accessedAt: ACCESSED,
});

const OSHA_TZ_CITATION: Citation = Object.freeze({
  url: 'https://www.osha.go.tz',
  title: 'Occupational Safety and Health Authority Tanzania — OSHA Act 2003',
  accessedAt: ACCESSED,
});

const FATF_KYC_CITATION: Citation = Object.freeze({
  url: 'https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Risk-based-approach-precious-stones.html',
  title:
    'FATF Risk-Based Approach for Dealers in Precious Metals and Stones (2008, revised)',
  accessedAt: ACCESSED,
});

// ---------------------------------------------------------------------------
// Contract helper
// ---------------------------------------------------------------------------

function contract(
  fields: ReadonlyArray<{
    readonly key: string;
    readonly kind:
      | 'string'
      | 'number'
      | 'boolean'
      | 'date'
      | 'enum'
      | 'geo'
      | 'reference';
    readonly required: boolean;
    readonly description?: string;
  }>,
): WorkflowContractShape {
  return Object.freeze({ fields: Object.freeze([...fields]) });
}

// ---------------------------------------------------------------------------
// 1. TRA Monthly VAT Filing
// ---------------------------------------------------------------------------

export const TRA_VAT_MONTHLY: VerticalWorkflowDefinition = Object.freeze({
  id: 'mining-tz.tra-vat-monthly',
  profileId: 'mining-tz',
  name: 'TRA Monthly VAT Filing',
  cadence: 'monthly',
  regulatorBinding: Object.freeze([
    Object.freeze({ regulatorId: 'tz-tra', filingKind: 'vat-monthly' }),
  ]),
  // TRA VAT filings are due by the 20th of the following month.
  dueDateRule: 'first-day-of-following-month + 19d',
  gracePeriodHours: 168,
  escalationHours: 24,
  inputContract: contract([
    { key: 'periodLabel', kind: 'string', required: true, description: 'YYYY-MM' },
    { key: 'taxableSupplies', kind: 'number', required: true },
    { key: 'inputTaxClaimed', kind: 'number', required: true },
    { key: 'exemptSupplies', kind: 'number', required: false },
    { key: 'zeroRatedSupplies', kind: 'number', required: false },
  ]),
  outputContract: contract([
    { key: 'vatPayable', kind: 'number', required: true },
    { key: 'controlNumber', kind: 'string', required: false, description: 'GePG control number after submission' },
    { key: 'filedAt', kind: 'date', required: false },
  ]),
  provenance: Object.freeze([TRA_VAT_CITATION]),
});

// ---------------------------------------------------------------------------
// 2. Tumemadini Annual Royalty Filing
// ---------------------------------------------------------------------------

export const TUMEMADINI_ANNUAL_ROYALTY: VerticalWorkflowDefinition = Object.freeze({
  id: 'mining-tz.tumemadini-annual-royalty',
  profileId: 'mining-tz',
  name: 'Tumemadini Annual Royalty Filing',
  cadence: 'annual',
  regulatorBinding: Object.freeze([
    Object.freeze({ regulatorId: 'tz-tumemadini', filingKind: 'royalty-annual' }),
  ]),
  dueDateRule: 'fiscal-year-end + 31d',
  gracePeriodHours: 720,
  escalationHours: 168,
  inputContract: contract([
    { key: 'fiscalYearEnd', kind: 'date', required: true },
    { key: 'commodity', kind: 'enum', required: true, description: 'gold | tanzanite | copper | …' },
    { key: 'tonnesProduced', kind: 'number', required: true },
    { key: 'grossSalesUsd', kind: 'number', required: true },
    {
      key: 'royaltyRatePercent',
      kind: 'number',
      required: true,
      description: 'Gold = 6%; inspection fee = 4% per Mining Act 2010 §86',
    },
    { key: 'inspectionFeeRatePercent', kind: 'number', required: true },
  ]),
  outputContract: contract([
    { key: 'royaltyAmountTzs', kind: 'number', required: true },
    { key: 'inspectionFeeTzs', kind: 'number', required: true },
    { key: 'controlNumber', kind: 'string', required: false },
    { key: 'filedAt', kind: 'date', required: false },
  ]),
  provenance: Object.freeze([TUMEMADINI_CITATION, MINING_ACT_CITATION]),
});

// ---------------------------------------------------------------------------
// 3. NEMC EIA Submission
// ---------------------------------------------------------------------------

export const NEMC_EIA: VerticalWorkflowDefinition = Object.freeze({
  id: 'mining-tz.nemc-eia',
  profileId: 'mining-tz',
  name: 'NEMC Environmental Impact Assessment Submission',
  cadence: 'event',
  regulatorBinding: Object.freeze([
    Object.freeze({ regulatorId: 'tz-nemc', filingKind: 'eia' }),
  ]),
  // EIA triggered by a project/permit event; review window 90d per EMA 2004.
  dueDateRule: 'trigger-event + 90d',
  gracePeriodHours: 336,
  escalationHours: 168,
  inputContract: contract([
    { key: 'projectScope', kind: 'string', required: true },
    { key: 'mineSiteRef', kind: 'reference', required: true, description: 'mine_site.id' },
    { key: 'baselineStudyAttached', kind: 'boolean', required: true },
    { key: 'mitigationPlanAttached', kind: 'boolean', required: true },
  ]),
  outputContract: contract([
    { key: 'rcaNumber', kind: 'string', required: false, description: 'Resolution of Approval (kibali)' },
    {
      key: 'status',
      kind: 'enum',
      required: true,
      description: 'pending | approved | conditional | rejected',
    },
  ]),
  provenance: Object.freeze([NEMC_CITATION]),
});

// ---------------------------------------------------------------------------
// 4. BoT Gold-Window FX Quarterly Reporting
// ---------------------------------------------------------------------------

export const BOT_FX_QUARTERLY: VerticalWorkflowDefinition = Object.freeze({
  id: 'mining-tz.bot-fx-quarterly',
  profileId: 'mining-tz',
  name: 'BoT Gold-Window FX Quarterly Reporting',
  cadence: 'quarterly',
  regulatorBinding: Object.freeze([
    Object.freeze({ regulatorId: 'tz-bot', filingKind: 'fx-quarterly' }),
  ]),
  dueDateRule: 'quarter-end + 30d',
  gracePeriodHours: 240,
  escalationHours: 72,
  inputContract: contract([
    { key: 'quarterLabel', kind: 'string', required: true, description: 'YYYY-Q[1-4]' },
    { key: 'goldDoreOzsExported', kind: 'number', required: true },
    { key: 'usdEquivalentInflow', kind: 'number', required: true },
    { key: 'tzsConvertedAmount', kind: 'number', required: true },
    { key: 'goldWindowFxRate', kind: 'number', required: true },
  ]),
  outputContract: contract([
    { key: 'reportingNumber', kind: 'string', required: false },
    { key: 'filedAt', kind: 'date', required: false },
  ]),
  provenance: Object.freeze([BOT_CITATION]),
});

// ---------------------------------------------------------------------------
// 5. OSHA-TZ Annual Safety Audit
// ---------------------------------------------------------------------------

export const OSHA_TZ_SAFETY_AUDIT: VerticalWorkflowDefinition = Object.freeze({
  id: 'mining-tz.osha-tz-safety-audit',
  profileId: 'mining-tz',
  name: 'OSHA-TZ Annual Workplace Safety Audit',
  cadence: 'annual',
  regulatorBinding: Object.freeze([
    Object.freeze({ regulatorId: 'tz-osha', filingKind: 'workplace-safety-audit' }),
  ]),
  dueDateRule: 'anniversary-of-licence + 0d',
  gracePeriodHours: 720,
  escalationHours: 336,
  inputContract: contract([
    { key: 'mineSiteRef', kind: 'reference', required: true },
    { key: 'auditPeriodLabel', kind: 'string', required: true, description: 'YYYY' },
    { key: 'recordableIncidents', kind: 'number', required: true },
    { key: 'lostTimeInjuries', kind: 'number', required: true },
    { key: 'fatalities', kind: 'number', required: true },
    { key: 'workforceHeadcount', kind: 'number', required: true },
  ]),
  outputContract: contract([
    { key: 'auditCertificateNumber', kind: 'string', required: false },
    {
      key: 'status',
      kind: 'enum',
      required: true,
      description: 'pending | passed | conditional | failed',
    },
    { key: 'correctiveActionsRequired', kind: 'number', required: false },
  ]),
  provenance: Object.freeze([OSHA_TZ_CITATION]),
});

// ---------------------------------------------------------------------------
// 6. Buyer KYC Verification (12-month refresh)
// ---------------------------------------------------------------------------

export const BUYER_KYC_VERIFICATION: VerticalWorkflowDefinition = Object.freeze({
  id: 'mining-tz.buyer-kyc-verification',
  profileId: 'mining-tz',
  name: 'Buyer KYC Verification (FATF-aligned 12-month refresh)',
  cadence: 'event',
  regulatorBinding: Object.freeze([
    Object.freeze({ regulatorId: 'tz-tumemadini', filingKind: 'kyc-verification' }),
  ]),
  dueDateRule: 'last-kyc-refresh + 365d',
  gracePeriodHours: 168,
  escalationHours: 48,
  inputContract: contract([
    { key: 'buyerRef', kind: 'reference', required: true, description: 'buyer.id' },
    { key: 'accreditationNumber', kind: 'string', required: true },
    {
      key: 'kycLevel',
      kind: 'enum',
      required: true,
      description: 'basic | enhanced | full',
    },
    { key: 'sanctionsScreeningHit', kind: 'boolean', required: true },
    { key: 'beneficialOwnersDeclared', kind: 'boolean', required: true },
  ]),
  outputContract: contract([
    {
      key: 'status',
      kind: 'enum',
      required: true,
      description: 'verified | flagged | rejected',
    },
    { key: 'nextRefreshDueAt', kind: 'date', required: true },
  ]),
  provenance: Object.freeze([FATF_KYC_CITATION, TUMEMADINI_CITATION]),
});

// ---------------------------------------------------------------------------
// Assembled list
// ---------------------------------------------------------------------------

export const MINING_TZ_WORKFLOWS: ReadonlyArray<VerticalWorkflowDefinition> =
  Object.freeze([
    TRA_VAT_MONTHLY,
    TUMEMADINI_ANNUAL_ROYALTY,
    NEMC_EIA,
    BOT_FX_QUARTERLY,
    OSHA_TZ_SAFETY_AUDIT,
    BUYER_KYC_VERIFICATION,
  ]);

export const MINING_TZ_CITATIONS: ReadonlyArray<Citation> = Object.freeze([
  TRA_VAT_CITATION,
  TUMEMADINI_CITATION,
  MINING_ACT_CITATION,
  NEMC_CITATION,
  BOT_CITATION,
  OSHA_TZ_CITATION,
  FATF_KYC_CITATION,
]);

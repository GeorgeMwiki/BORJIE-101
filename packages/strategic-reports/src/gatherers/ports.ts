/**
 * Advisor ports for the gatherer stage.
 *
 * Every gatherer accepts one of these typed ports as input. The shape
 * is the MINIMUM contract the gatherer needs — never the full advisor
 * surface. This keeps the `@borjie/strategic-reports` package
 * free of compile-time coupling to the advisor packages so the engine
 * can be wired against test doubles, against real advisors, or against
 * a remote RPC façade interchangeably.
 *
 * The composition root in `services/api-gateway` (or any other host)
 * wires the real advisor functions to these port shapes.
 */

import type { Citation, EvidenceFragment, ReportSpec } from '../types.js';

// ────────────────────────────────────────────────────────────────────────────
// Common shapes returned by ports — kept minimal on purpose.
// ────────────────────────────────────────────────────────────────────────────

export interface MoneyAmount {
  readonly currency: string; // ISO-4217
  readonly value: number;
}

export interface RevenueLine {
  readonly periodLabel: string; // 'Apr 2026', 'FY26-Q2'
  readonly billed: MoneyAmount;
  readonly collected: MoneyAmount;
  readonly outstanding: MoneyAmount;
}

export interface ProductionLine {
  readonly periodLabel: string;
  readonly producingSites: number;
  readonly totalSites: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Offtake financial port — drives offtake_financial_performance + AOR rollup.
// ────────────────────────────────────────────────────────────────────────────

export interface OfftakeFinancialPort {
  fetchRevenueTrend(args: {
    readonly orgId: string;
    readonly siteId?: string;
    readonly periodStart: string;
    readonly periodEnd: string;
  }): Promise<ReadonlyArray<RevenueLine>>;
  fetchProductionTrend(args: {
    readonly orgId: string;
    readonly siteId?: string;
    readonly periodStart: string;
    readonly periodEnd: string;
  }): Promise<ReadonlyArray<ProductionLine>>;
}

// ────────────────────────────────────────────────────────────────────────────
// Conditional-survey port — drives conditional_survey_of_assets + AOR.
// ────────────────────────────────────────────────────────────────────────────

export interface SurveyDefect {
  readonly defectId: string;
  readonly element: string; // 'processing-plant', 'haul-road', 'conveyor', 'tailings-dam'
  readonly severity: 'minor' | 'moderate' | 'major' | 'critical';
  readonly costEstimate: MoneyAmount;
  readonly photoRef?: string;
  readonly notedAtIso: string;
}

export interface SurveySnapshot {
  readonly siteId: string;
  readonly surveyDateIso: string;
  readonly surveyorId: string;
  readonly overallGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  readonly defects: ReadonlyArray<SurveyDefect>;
}

export interface ConditionalSurveyPort {
  fetchLatestSurvey(args: { readonly siteId: string }): Promise<SurveySnapshot | null>;
  fetchPriorSurvey(args: { readonly siteId: string }): Promise<SurveySnapshot | null>;
}

// ────────────────────────────────────────────────────────────────────────────
// Acquisition advisor port — drives acquisition_deal_ic_memo.
// ────────────────────────────────────────────────────────────────────────────

export interface AcquisitionDeal {
  readonly dealId: string;
  readonly siteId: string;
  readonly askPrice: MoneyAmount;
  readonly modelledValue: MoneyAmount;
  readonly noi: MoneyAmount;
  readonly impliedCapRate: number; // decimal, 0.075
  readonly compTriangulationRange: { readonly low: MoneyAmount; readonly high: MoneyAmount };
  readonly dealKillers: ReadonlyArray<{ readonly id: string; readonly title: string; readonly severity: 'low' | 'medium' | 'high' }>;
  readonly recommendation: 'pursue' | 'pass' | 'rebid';
}

export interface AcquisitionAdvisorPort {
  fetchDeal(args: { readonly dealId: string }): Promise<AcquisitionDeal | null>;
}

// ────────────────────────────────────────────────────────────────────────────
// Lifecycle advisor port — drives disposition + refinancing memos.
// ────────────────────────────────────────────────────────────────────────────

export interface DispositionThesis {
  readonly siteId: string;
  readonly recommendedExit: 'hold' | 'list-now' | 'list-next-quarter' | 'wait';
  readonly impliedExitValue: MoneyAmount;
  readonly buyerPool: ReadonlyArray<{ readonly buyerType: string; readonly weight: number }>;
  readonly sensitivities: ReadonlyArray<{ readonly factor: string; readonly delta: number; readonly impactPct: number }>;
}

export interface RefinancingProposal {
  readonly siteId: string;
  readonly currentLoan: { readonly principal: MoneyAmount; readonly ratePct: number; readonly maturityIso: string };
  readonly proposed: { readonly principal: MoneyAmount; readonly ratePct: number; readonly term_yrs: number; readonly ltvPct: number; readonly dscr: number };
  readonly lenderShortlist: ReadonlyArray<{ readonly name: string; readonly fitScore: number }>;
  readonly stressTests: ReadonlyArray<{ readonly scenario: string; readonly dscrUnderStress: number; readonly covenantOk: boolean }>;
}

export interface LifecycleAdvisorPort {
  fetchDispositionThesis(args: { readonly siteId: string }): Promise<DispositionThesis | null>;
  fetchRefinancingProposal(args: { readonly siteId: string }): Promise<RefinancingProposal | null>;
}

// ────────────────────────────────────────────────────────────────────────────
// Sustainability advisor port — drives sustainability_ghg_report + AOR.
// ────────────────────────────────────────────────────────────────────────────

export interface SustainabilitySnapshot {
  readonly siteId: string;
  readonly periodLabel: string;
  readonly scope1KgCO2e: number;
  readonly scope2KgCO2e: number;
  readonly scope3KgCO2e: number;
  readonly intensityKgCO2ePerTonne: number;
  readonly crremDeltaPct: number; // -ve = below pathway, +ve = above
  readonly euTaxonomyAligned: boolean;
  readonly bngNetGainPct?: number;
  readonly nbsOpportunities: ReadonlyArray<{ readonly id: string; readonly title: string; readonly priority: 'high' | 'medium' | 'low' }>;
}

export interface SustainabilityAdvisorPort {
  fetchSnapshot(args: { readonly siteId: string; readonly periodStart: string; readonly periodEnd: string }): Promise<SustainabilitySnapshot | null>;
}

// ────────────────────────────────────────────────────────────────────────────
// Expansion + green-angle advisors — drive expansion_strategy_memo.
// ────────────────────────────────────────────────────────────────────────────

export interface ExpansionRecommendation {
  readonly orgId: string;
  readonly markets: ReadonlyArray<{ readonly market: string; readonly riskAdjYoCPct: number; readonly absorption_mo: number; readonly verdict: 'enter' | 'monitor' | 'avoid' }>;
  readonly capitalStack: { readonly debtPct: number; readonly prefEquityPct: number; readonly commonEquityPct: number };
  readonly preferredHbu: string;
}

export interface GreenAngleSummary {
  readonly orgId: string;
  readonly topAngles: ReadonlyArray<{ readonly id: string; readonly title: string; readonly impactScore: number; readonly capexEstimate: MoneyAmount }>;
}

export interface ExpansionAdvisorPort {
  fetchExpansionRecommendation(args: { readonly orgId: string }): Promise<ExpansionRecommendation | null>;
}

export interface GreenAngleAdvisorPort {
  fetchGreenAngleSummary(args: { readonly orgId: string }): Promise<GreenAngleSummary | null>;
}

// ────────────────────────────────────────────────────────────────────────────
// Buyer context port — drives buyer_credit_risk_profile.
// ────────────────────────────────────────────────────────────────────────────

export interface BuyerContextProfile {
  readonly buyerPersonId: string;
  readonly displayName: string;
  readonly lifecycleStage: string; // 'onboarding', 'paying', 'outstanding', 'churn-risk'
  readonly paymentHistory: ReadonlyArray<{ readonly periodLabel: string; readonly onTimePct: number; readonly outstandingDays: number }>;
  readonly complaints: ReadonlyArray<{ readonly id: string; readonly summary: string; readonly resolvedAtIso?: string }>;
  readonly creditSignals: ReadonlyArray<{ readonly signal: string; readonly weight: number }>;
}

export interface BuyerContextPort {
  fetchBuyerProfile(args: { readonly buyerPersonId: string; readonly orgId: string }): Promise<BuyerContextProfile | null>;
}

// ────────────────────────────────────────────────────────────────────────────
// Royalty-roll port — drives royalty_roll_outstanding_ledger + AOR.
// ────────────────────────────────────────────────────────────────────────────

export interface RoyaltyRollEntry {
  readonly siteId: string;
  readonly buyerName: string;
  readonly monthlyRoyalty: MoneyAmount;
  readonly supplyStartIso: string;
  readonly supplyEndIso: string;
  readonly outstanding: MoneyAmount;
  readonly outstandingAgeingDays: number;
}

export interface RoyaltyRollPort {
  fetchRoyaltyRoll(args: { readonly orgId: string; readonly siteId?: string; readonly asOfIso: string }): Promise<ReadonlyArray<RoyaltyRollEntry>>;
}

// ────────────────────────────────────────────────────────────────────────────
// AdvisorPorts bundle — passed once to the engine; gatherers pick fields.
// ────────────────────────────────────────────────────────────────────────────

export interface AdvisorPorts {
  readonly offtakeFinancial?: OfftakeFinancialPort;
  readonly conditionalSurvey?: ConditionalSurveyPort;
  readonly acquisition?: AcquisitionAdvisorPort;
  readonly lifecycle?: LifecycleAdvisorPort;
  readonly sustainability?: SustainabilityAdvisorPort;
  readonly expansion?: ExpansionAdvisorPort;
  readonly greenAngle?: GreenAngleAdvisorPort;
  readonly buyerContext?: BuyerContextPort;
  readonly royaltyRoll?: RoyaltyRollPort;
}

// ────────────────────────────────────────────────────────────────────────────
// Shared helper — turn a port-shaped value into an EvidenceFragment with a
// stable id + an accompanying Citation. Centralised so the gatherers stay
// short and the id-derivation policy is owned in one place.
// ────────────────────────────────────────────────────────────────────────────

export interface BuildFragmentArgs {
  readonly id: string;
  readonly summary: string;
  readonly source: Citation['source'];
  readonly data?: Readonly<Record<string, unknown>>;
}

export function buildEvidenceFragment(args: BuildFragmentArgs): EvidenceFragment {
  return {
    id: args.id,
    summary: args.summary,
    source: args.source,
    ...(args.data !== undefined ? { data: args.data } : {}),
  };
}

export function citationFromFragment(fragment: EvidenceFragment, claim: string, confidence?: number): Citation {
  return {
    id: fragment.id,
    claim,
    source: fragment.source,
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

/**
 * Per-source health helper — keeps every gatherer recording the SAME
 * shape so the composer can rely on `sourceHealth[i].status === 'unavailable'`
 * to flag a missing-section degradation rather than silently dropping.
 */
export function sourceHealth(
  sourceId: string,
  status: 'ok' | 'partial' | 'unavailable',
  note?: string,
): { sourceId: string; status: 'ok' | 'partial' | 'unavailable'; note?: string } {
  return note !== undefined ? { sourceId, status, note } : { sourceId, status };
}

/**
 * Type-safe formatter used by every gatherer when constructing a
 * one-line evidence summary. Centralises the money-format policy.
 */
export function formatMoney(m: MoneyAmount): string {
  return `${m.currency} ${m.value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/**
 * Pure helper used by gatherers and composers — derive a percentage
 * delta between billed and collected (collection performance %).
 */
export function collectionPct(line: RevenueLine): number {
  if (line.billed.value === 0) return 0;
  return (line.collected.value / line.billed.value) * 100;
}

/**
 * Helper for `period-start` → `period-end` reuse across gatherers.
 */
export function periodWindow(spec: ReportSpec): { periodStart: string; periodEnd: string } {
  return { periodStart: spec.period.periodStart, periodEnd: spec.period.periodEnd };
}

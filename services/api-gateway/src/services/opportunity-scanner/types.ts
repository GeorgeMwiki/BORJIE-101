/**
 * Opportunity Scanner — shared types (Wave OWNER-OS OPPORTUNITY-SCANNER).
 *
 * Mr. Mwikila proactively scans the owner's full tenant state every turn
 * for UPSIDE: things the owner could do to save money, grow revenue,
 * optimize taxes, hit a regulatory window, route capital better, time a
 * market, switch a supplier, batch a renewal, claim a subsidy.
 *
 * This file declares:
 *   - `OpportunityKind` — the 12 canonical kinds the brain scans for.
 *   - `Opportunity` — the wire-shape returned by the scanner + emitted
 *                    via `<opportunity>` SSE blocks.
 *   - `ScanState` — the snapshot of tenant data each rule inspects.
 *   - `ScanRule` — the typed interface every rule in `scan-rules.ts`
 *                  implements: `detect()` + `evaluate()`.
 *
 * Tenant isolation: every rule receives only the current tenant's
 * `ScanState` slice — built by the resolver layer using RLS-bound
 * Drizzle reads. No rule reaches across tenants.
 *
 * Never fabricate values. Every `expectedValueTzs` / `savingsTzs` is
 * grounded in real resolver data; `null` is fine when the underlying
 * figure is unknown (the FE renders a soft "estimate pending" pill).
 */

import { z } from 'zod';

// ─── Opportunity kinds ──────────────────────────────────────────────

export const OPPORTUNITY_KINDS = [
  'cost_saving',
  'revenue',
  'tax_efficiency',
  'regulatory_window',
  'capital',
  'market_timing',
  'operational_arbitrage',
  'hr',
  'compliance_shortcut',
  'estate_planning',
  'counterparty',
  'peer_best_practice',
] as const;

export type OpportunityKind = (typeof OPPORTUNITY_KINDS)[number];

// ─── Required-action shape (one-click follow-up the FE can fire) ────

export const OpportunityActionSchema = z
  .object({
    action: z.string().min(1).max(80),
    target: z.string().min(1).max(120).optional(),
    payload: z.record(z.unknown()).default({}),
  })
  .strict();

export type OpportunityAction = z.infer<typeof OpportunityActionSchema>;

// ─── Bilingual headline + narrative ─────────────────────────────────

export const BilingualSchema = z
  .object({
    en: z.string().min(1).max(600),
    sw: z.string().min(1).max(600),
  })
  .strict();

export type Bilingual = z.infer<typeof BilingualSchema>;

// ─── Opportunity wire-shape ─────────────────────────────────────────

export const OpportunitySchema = z
  .object({
    id: z.string().min(1).max(80),
    kind: z.enum(OPPORTUNITY_KINDS),
    headline: BilingualSchema,
    narrative: BilingualSchema,
    /** Annualised TZS value (savings or revenue). null when not estimable. */
    expectedValueTzs: z.number().nonnegative().nullable().optional(),
    /** Discrete TZS savings figure (monthly or per-event). */
    savingsTzs: z.number().nonnegative().nullable().optional(),
    /** 0 (low) — 1 (high). */
    confidence: z.number().min(0).max(1),
    /** Days the opportunity remains actionable; -1 = open-ended. */
    timeWindowDays: z.number().int(),
    requiresActions: z.array(OpportunityActionSchema).max(3).default([]),
    relatedScopes: z
      .array(z.string().min(1).max(40))
      .max(8)
      .default([]),
    citations: z
      .array(z.string().min(1).max(80))
      .max(8)
      .default([]),
  })
  .strict();

export type Opportunity = z.infer<typeof OpportunitySchema>;

// ─── Scan state — snapshot every rule inspects ──────────────────────

/**
 * The materialised slice of tenant state the scanner passes to every
 * rule. Sourced lazily by the resolver layer — only the fields a rule
 * actually reads are filled (the rest are `null`). All numbers are
 * already in TZS unless the field name says otherwise.
 *
 * Keep this shape append-only; rules treat any unknown field as
 * `undefined` and degrade gracefully.
 */
export interface ScanState {
  readonly tenantId: string;
  readonly nowIso: string;

  // ── Fuel + production
  readonly fuel?: {
    readonly litresPerTonneRolling30d: number | null;
    readonly peerP25LitresPerTonne: number | null;
    readonly currentDieselTzsPerLitre: number | null;
    readonly tonnesProducedRolling30d: number | null;
    readonly supplierCount: number;
  } | null;

  // ── Treasury + FX
  readonly fx?: {
    readonly lbmaFixUsdPerOz: number | null;
    readonly lbmaFixMean30dUsdPerOz: number | null;
    readonly lbmaFixStdev30d: number | null;
    readonly botGoldWindowOpen: boolean;
    readonly parcelOzReady: number | null;
  } | null;

  // ── Tax + regulator
  readonly tax?: {
    readonly traQuarterlyElectionDaysUntilDeadline: number | null;
    readonly currentRoyaltyRatePct: number | null;
    readonly altRoyaltyRatePct: number | null;
    readonly quarterlyRoyaltyTzs: number | null;
  } | null;

  readonly regulator?: {
    readonly nemcAmnestyWindowOpen: boolean;
    readonly nemcAmnestyDaysRemaining: number | null;
    readonly tenantQualifiesForAmnesty: boolean;
    readonly estimatedPenaltyAvoidedTzs: number | null;
  } | null;

  // ── Estate + succession
  readonly estate?: {
    readonly subsidiaryCount: number;
    readonly intercompanySurplusTzs: number | null;
    readonly holdingCoExists: boolean;
    readonly overdueSuccessionReviewCount: number;
    readonly forestryEntityCount: number;
  } | null;

  // ── Marketplace + buyers
  readonly marketplace?: {
    readonly latestBuyerOfferPremiumOverLbmaPct: number | null;
    readonly latestBuyerOfferParcelOzEquivalent: number | null;
    readonly latestBuyerName: string | null;
  } | null;

  // ── Vendors
  readonly vendors?: {
    readonly categoriesWithMultipleSuppliers: ReadonlyArray<{
      readonly category: string;
      readonly supplierCount: number;
      readonly annualSpendTzs: number;
    }>;
  } | null;

  // ── Workforce
  readonly workforce?: {
    readonly apprenticeshipEligibleCount: number;
    readonly vetaSubsidyPerApprenticeTzs: number | null;
    readonly icaCertExpiringIn60dCount: number;
    readonly icaCertPerCertFeeTzs: number | null;
  } | null;

  // ── Insurance
  readonly insurance?: {
    readonly policyDueWithin60d: boolean;
    readonly currentAnnualPremiumTzs: number | null;
    readonly bestMarketQuoteTzs: number | null;
  } | null;

  // ── Peer cohort
  readonly peer?: {
    readonly tenantProductionPercentile: number | null;
    readonly p75Pattern: string | null;
    readonly tenantUsesP75Pattern: boolean;
  } | null;

  // ── Counterparties
  readonly counterparties?: {
    readonly newBuyerPremiumOpportunity: {
      readonly buyerId: string;
      readonly buyerName: string;
      readonly premiumOverFixPct: number;
      readonly parcelOzEquivalent: number;
    } | null;
  } | null;

  // ── Forestry / carbon
  readonly carbon?: {
    readonly eligibleHectares: number | null;
    readonly tzsPerHectarePerYear: number | null;
  } | null;

  // ── Energy + capital
  readonly energy?: {
    readonly currentGridTariffTzsPerKwh: number | null;
    readonly solarHybridTzsPerKwh: number | null;
    readonly monthlyKwhConsumption: number | null;
  } | null;

  readonly capital?: {
    readonly currentLoanRatePct: number | null;
    readonly tibBetterRatePct: number | null;
    readonly loanBalanceTzs: number | null;
    readonly cashOnHandTzs: number | null;
    readonly idleCashOver90dTzs: number | null;
    readonly tibillsYieldPct: number | null;
  } | null;

  // ── Operations
  readonly ops?: {
    readonly nightShiftIdleCapacityPct: number | null;
    readonly nightShiftFuelDeltaTzsPerTonne: number | null;
    readonly bcmHaulDistanceMetresMean: number | null;
    readonly bcmHaulDistanceP25Metres: number | null;
    readonly rejectedOreTonnesRolling30d: number | null;
    readonly downstreamProcessingTzsPerTonne: number | null;
    readonly stockpileAgeP90Days: number | null;
  } | null;
}

// ─── Scan rule interface ────────────────────────────────────────────

export interface ScanRule {
  readonly id: string;
  readonly kind: OpportunityKind;
  readonly requiresAction: boolean;
  /** Cheap predicate — runs before evaluate(); avoids work when not applicable. */
  detect(state: ScanState): boolean;
  /** Heavy evaluation — returns a full Opportunity. Only called when detect() is true. */
  evaluate(state: ScanState): Opportunity;
}

/**
 * Dynamic rent optimizer types.
 *
 * The pricing loop is data-in -> LLM -> (clamped) proposal -> approval queue.
 * NOTHING here applies a price change directly. The ApprovalService owns the
 * actual rent mutation.
 */

import type { Citation } from '../phl-common/types.js';

export interface AiProvenance {
  readonly modelVersion: string;
  readonly promptHash: string;
  readonly confidence: number;
  readonly explanation: string;
}

export interface MarketSignal {
  readonly id: string;
  readonly unitId: string;
  readonly currencyCode: string;
  readonly ourRentMinor: number;
  readonly marketMedianMinor: number | null;
  readonly marketP25Minor: number | null;
  readonly marketP75Minor: number | null;
  readonly sampleSize: number;
  readonly driftFlag: 'below_market' | 'above_market' | 'on_band' | null;
  readonly observedAt: string; // ISO-8601
}

export interface OccupancyRollup {
  readonly unitId: string;
  readonly windowDays: number;
  readonly occupancyPct: number; // 0..1
  readonly vacancyDays: number;
  readonly rollupHash: string;
}

export interface ChurnSignal {
  readonly id: string;
  readonly customerId: string;
  readonly unitId: string;
  readonly churnProbability: number; // 0..1
  readonly horizonDays: number;
}

export interface InspectionSignal {
  readonly id: string;
  readonly unitId: string;
  readonly conditionGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  readonly issuesCount: number;
  readonly observedAt: string;
}

export interface PricingInputs {
  readonly tenantId: string;
  readonly unitId: string;
  readonly propertyId?: string;
  readonly countryCode: string; // ISO-3166-1 alpha-2 — drives rent-control lookup
  readonly market?: MarketSignal;
  readonly occupancy?: OccupancyRollup;
  readonly churn?: ChurnSignal;
  readonly inspection?: InspectionSignal;
  readonly seasonalityMonth?: number; // 1..12
  readonly currentRentMinor: number;
  readonly currencyCode: string;
}

export interface RentRecommendation {
  readonly id: string;
  readonly tenantId: string;
  readonly unitId: string;
  readonly propertyId: string | null;
  readonly currencyCode: string;
  readonly currentRentMinor: number;
  readonly recommendedRentMinor: number;
  readonly deltaPct: number;
  readonly confidence: number;
  readonly suggestedReviewDate: string; // YYYY-MM-DD
  readonly citations: readonly Citation[];
  readonly regulatoryCapPct: number | null;
  readonly capBreached: boolean;
  readonly explanation: string;
  readonly modelVersion: string;
  readonly promptHash: string;
  readonly status: 'proposed';
  readonly createdAt: string;
}

export interface RentIncreaseCapSnapshot {
  /**
   * Maximum rent-increase percentage permitted in the jurisdiction in a
   * trailing 12-month window. `null` means unrestricted — caller uses
   * their own ceiling.
   */
  readonly maxIncreasePct: number | null;
  readonly sourceCitation?: string;
}

/**
 * Global-first rent-control lookup. The composition root binds this to the
 * jurisdiction plugin's leaseLaw snapshot. When a plugin declares no
 * `rentIncreaseCap`, `maxIncreasePct` is null and no regulatory clamp fires.
 */
export interface RentControlLookup {
  (countryCode: string): RentIncreaseCapSnapshot;
}

export interface PricingLLMPort {
  /**
   * Compute a per-unit recommendation. Inputs are pre-assembled — the LLM
   * just has to reason about them and justify its delta.
   *
   * Returns the RAW recommendation (may exceed regulatory cap — the caller
   * clamps). `confidence` MUST be in [0, 1].
   */
  propose(input: {
    readonly inputs: PricingInputs;
    readonly promptHash: string;
  }): Promise<{
    readonly recommendedRentMinor: number;
    readonly confidence: number;
    readonly explanation: string;
    readonly modelVersion: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costUsdMicro: number;
  }>;
}

export interface RentRecommendationRepository {
  insert(row: RentRecommendation): Promise<RentRecommendation>;
  listByUnit(
    tenantId: string,
    unitId: string,
    limit?: number,
  ): Promise<readonly RentRecommendation[]>;
}

export interface ApprovalQueuePort {
  /**
   * Queue a recommendation into the approval chain. Returns the
   * approval_request_id so downstream code can track the decision.
   * Every ApprovalService-compatible implementation must route rent changes
   * according to the owner's autonomy policy.
   */
  queueRentChange(input: {
    readonly tenantId: string;
    readonly unitId: string;
    readonly currentRentMinor: number;
    readonly recommendedRentMinor: number;
    readonly currencyCode: string;
    readonly recommendationId: string;
    readonly explanation: string;
    readonly citations: readonly Citation[];
  }): Promise<{ readonly approvalRequestId: string } | null>;
}


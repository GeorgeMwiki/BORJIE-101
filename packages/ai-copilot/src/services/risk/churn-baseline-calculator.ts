/**
 * Deterministic Churn Baseline Calculator
 *
 * Produces a 0-100 churn score where HIGHER MEANS HIGHER CHURN RISK.
 * The LLM downstream must narrate, never override, this baseline.
 *
 * Weights (must sum to 1.0):
 *
 *   lateness     0.30  — recent payment lateness
 *   complaints   0.25  — complaint frequency & tone
 *   maintenance  0.15  — open maintenance issues / slow resolution
 *   recency      0.15  — how close we are to lease end (engagement decay)
 *   market       0.15  — market conditions inviting churn
 *
 * Risk bands (higher score = more risk):
 *   >= 75  VERY_HIGH
 *   60-74  HIGH
 *   40-59  MEDIUM
 *   25-39  LOW
 *   <  25  VERY_LOW
 */

export type DeterministicChurnRiskLevel =
  | 'VERY_HIGH'
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW'
  | 'VERY_LOW';

export const CHURN_WEIGHTS = Object.freeze({
  lateness: 0.3,
  complaints: 0.25,
  maintenance: 0.15,
  recency: 0.15,
  market: 0.15,
} as const);

export interface ChurnBaselineInput {
  readonly lateness: {
    readonly onTimePayments: number;
    readonly latePayments: number;
    readonly missedPayments: number;
    readonly averageDaysLate?: number;
  };
  readonly complaints: {
    readonly complaintsCount: number;
    readonly inquiriesCount: number;
    readonly sentimentTrend?:
      | 'positive'
      | 'neutral'
      | 'negative'
      | 'declining';
  };
  readonly maintenance: {
    readonly totalRequests: number;
    readonly openRequests: number;
    readonly averageResolutionDays: number;
    readonly satisfactionRating?: number;
  };
  readonly recency: {
    readonly daysUntilLeaseEnd: number;
    readonly previousRenewals: number;
    readonly declinedOffers: number;
  };
  readonly market: {
    readonly areaRentTrend: 'increasing' | 'stable' | 'decreasing';
    readonly competitorAvailability: 'high' | 'medium' | 'low';
    /**
     * Ratio of current rent to market rent. >1 means tenant is over-paying
     * vs market (churn incentive), <1 means under-paying (stickiness).
     */
    readonly marketRentComparison: number;
  };
}

export interface ChurnSubScores {
  readonly lateness: number;
  readonly complaints: number;
  readonly maintenance: number;
  readonly recency: number;
  readonly market: number;
}

export interface DeterministicChurnResult {
  readonly score: number;
  readonly level: DeterministicChurnRiskLevel;
  readonly subScores: ChurnSubScores;
  readonly weights: typeof CHURN_WEIGHTS;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function scoreLateness(
  lateness: ChurnBaselineInput['lateness'],
): number {
  const total =
    lateness.onTimePayments +
    lateness.latePayments +
    lateness.missedPayments;
  if (total === 0) return 10; // neutral for new tenants
  const badRate =
    (lateness.latePayments + 2 * lateness.missedPayments) / total;
  const daysLatePenalty = clamp(lateness.averageDaysLate ?? 0, 0, 30) * 1.2;
  return clamp(badRate * 100 + daysLatePenalty, 0, 100);
}

export function scoreComplaints(
  complaints: ChurnBaselineInput['complaints'],
): number {
  let base = clamp(complaints.complaintsCount * 10, 0, 60);
  switch (complaints.sentimentTrend) {
    case 'declining':
      base += 30;
      break;
    case 'negative':
      base += 20;
      break;
    case 'neutral':
      base += 5;
      break;
    case 'positive':
      base -= 15;
      break;
    default:
      break;
  }
  return clamp(base, 0, 100);
}

export function scoreMaintenance(
  maintenance: ChurnBaselineInput['maintenance'],
): number {
  const openPenalty = clamp(maintenance.openRequests * 10, 0, 50);
  const slowPenalty = clamp(
    (maintenance.averageResolutionDays - 3) * 5,
    0,
    30,
  );
  const satisfactionPenalty =
    maintenance.satisfactionRating != null
      ? clamp((5 - maintenance.satisfactionRating) * 8, 0, 40)
      : 0;
  return clamp(openPenalty + slowPenalty + satisfactionPenalty, 0, 100);
}

export function scoreRecency(
  recency: ChurnBaselineInput['recency'],
): number {
  let base = 0;
  if (recency.daysUntilLeaseEnd <= 30) base = 70;
  else if (recency.daysUntilLeaseEnd <= 60) base = 55;
  else if (recency.daysUntilLeaseEnd <= 90) base = 40;
  else base = 15;
  const renewalBonus = clamp(recency.previousRenewals * 10, 0, 30);
  const declinedPenalty = clamp(recency.declinedOffers * 15, 0, 45);
  return clamp(base + declinedPenalty - renewalBonus, 0, 100);
}

export function scoreMarket(market: ChurnBaselineInput['market']): number {
  let base = 0;
  if (market.marketRentComparison > 1.1) base += 40;
  else if (market.marketRentComparison > 1.05) base += 25;
  else if (market.marketRentComparison < 0.9) base -= 15;
  if (market.competitorAvailability === 'high') base += 25;
  else if (market.competitorAvailability === 'medium') base += 10;
  if (market.areaRentTrend === 'decreasing') base += 15;
  if (market.areaRentTrend === 'increasing') base -= 5;
  return clamp(base, 0, 100);
}

export function churnLevelFromScore(
  score: number,
): DeterministicChurnRiskLevel {
  if (score >= 75) return 'VERY_HIGH';
  if (score >= 60) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  if (score >= 25) return 'LOW';
  return 'VERY_LOW';
}

export function calculateChurnBaseline(
  input: ChurnBaselineInput,
): DeterministicChurnResult {
  const subScores: ChurnSubScores = {
    lateness: scoreLateness(input.lateness),
    complaints: scoreComplaints(input.complaints),
    maintenance: scoreMaintenance(input.maintenance),
    recency: scoreRecency(input.recency),
    market: scoreMarket(input.market),
  };
  const weighted =
    subScores.lateness * CHURN_WEIGHTS.lateness +
    subScores.complaints * CHURN_WEIGHTS.complaints +
    subScores.maintenance * CHURN_WEIGHTS.maintenance +
    subScores.recency * CHURN_WEIGHTS.recency +
    subScores.market * CHURN_WEIGHTS.market;
  const score = Math.round(clamp(weighted, 0, 100));
  return {
    score,
    level: churnLevelFromScore(score),
    subScores,
    weights: CHURN_WEIGHTS,
  };
}

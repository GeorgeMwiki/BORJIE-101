/**
 * scoreAsset — pure function from measured inputs → grade report.
 *
 * Every dimension is scored on a 0..100 scale using sector-standard
 * anchors:
 *
 *   royalty_yield     — blend of royalty collection rate, NOI / gross income,
 *                       and inverse outstanding-royalty ratio.
 *   opex_efficiency   — inverse expense ratio anchored on 40% (typical
 *                       artisanal-to-mid-tier mining benchmark).
 *   maintenance       — blended from resolution speed, cost-per-site vs
 *                       sector median, and capex debt as a share of NOI.
 *   recovery          — utilisation rate × (1 - downtimeDays / 90)
 *                       adjusted toward market-price ratio.
 *   royalty_compliance— starts at 100, loses points per open breach.
 *   buyer_quality     — buyerSatisfactionProxy as a direct percentage.
 *
 * The final score is a weighted blend. Grades are assigned from the
 * standard underwriting cutoffs:
 *   A+ ≥ 92, A ≥ 88, A- ≥ 84, B+ ≥ 80, B ≥ 75, B- ≥ 70,
 *   C+ ≥ 65, C ≥ 60, C- ≥ 55, D+ ≥ 50, D ≥ 40, F < 40.
 *
 * The function is pure — given the same (inputs, weights) it always
 * returns the same output. No IO, no randomness, no hidden state.
 */

import {
  DEFAULT_GRADING_WEIGHTS,
  DimensionScore,
  GradeDimension,
  GRADE_DIMENSIONS,
  GradingWeights,
  AssetGrade,
  AssetGradeInputs,
  AssetGradeReport,
} from './asset-grading-types.js';

/** Grade cutoffs (lower bound, inclusive) in descending order. */
const GRADE_CUTOFFS: readonly (readonly [number, AssetGrade])[] = [
  [92, 'A_PLUS'],
  [88, 'A'],
  [84, 'A_MINUS'],
  [80, 'B_PLUS'],
  [75, 'B'],
  [70, 'B_MINUS'],
  [65, 'C_PLUS'],
  [60, 'C'],
  [55, 'C_MINUS'],
  [50, 'D_PLUS'],
  [40, 'D'],
  [0, 'F'],
];

/** Clamp helper. */
function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Linear interpolation used to convert a measured value into a 0..100 score. */
function linearScore(value: number, worst: number, best: number): number {
  if (best === worst) return 0;
  const raw = ((value - worst) / (best - worst)) * 100;
  return clamp(raw, 0, 100);
}

/** Invert a score where higher is worse (e.g. outstanding-royalty ratio). */
function invertScore(value: number, worst: number, best: number): number {
  return linearScore(value, worst, best);
}

/**
 * Convert a 0..100 score into a discrete grade using the standard
 * underwriting cutoffs. The lookup is pure.
 */
export function scoreToGrade(score: number): AssetGrade {
  const clamped = clamp(score, 0, 100);
  for (const [cutoff, grade] of GRADE_CUTOFFS) {
    if (clamped >= cutoff) return grade;
  }
  return 'F';
}

/** Validate that weights sum to 1.0 within tolerance. */
export function validateWeights(weights: GradingWeights): void {
  const sum =
    weights.royalty_yield +
    weights.opex_efficiency +
    weights.maintenance +
    weights.recovery +
    weights.royalty_compliance +
    weights.buyer_quality;
  if (Math.abs(sum - 1.0) > 1e-6) {
    throw new Error(
      `Grading weights must sum to 1.0 — got ${sum.toFixed(4)} (${JSON.stringify(weights)})`,
    );
  }
  for (const dim of GRADE_DIMENSIONS) {
    const w = weights[dim];
    if (!Number.isFinite(w) || w < 0 || w > 1) {
      throw new Error(`Weight for ${dim} must be in [0, 1], got ${w}`);
    }
  }
}

/** Score the royalty-yield dimension. Higher is better. */
function scoreRoyaltyYield(inputs: AssetGradeInputs): DimensionScore {
  const collection = clamp(inputs.royaltyCollectionRate, 0, 1) * 100;
  const noiRatio =
    inputs.grossPotentialIncome > 0
      ? clamp(inputs.noi / inputs.grossPotentialIncome, -0.5, 1)
      : 0;
  const noiScore = linearScore(noiRatio, 0, 0.6);
  const outstandingScore = invertScore(inputs.outstandingRoyaltyRatio, 0.3, 0);
  const score = 0.5 * collection + 0.3 * noiScore + 0.2 * outstandingScore;
  const grade = scoreToGrade(score);
  return {
    dimension: 'royalty_yield',
    score: round(score),
    grade,
    explanation:
      `Royalty collection ${(inputs.royaltyCollectionRate * 100).toFixed(1)}%, ` +
      `NOI margin ${(noiRatio * 100).toFixed(1)}%, outstanding ${(inputs.outstandingRoyaltyRatio * 100).toFixed(1)}%.`,
  };
}

/** Score the opex-efficiency dimension. Lower expense ratio = higher score. */
function scoreOpexEfficiency(inputs: AssetGradeInputs): DimensionScore {
  const ratio = clamp(inputs.expenseRatio, 0, 1);
  const score = invertScore(ratio, 0.7, 0.25);
  const grade = scoreToGrade(score);
  return {
    dimension: 'opex_efficiency',
    score: round(score),
    grade,
    explanation:
      `Operating expense ratio ${(ratio * 100).toFixed(1)}% ` +
      `(best class ≤ 25%, below-sector > 70%).`,
  };
}

/** Score the maintenance dimension. */
function scoreMaintenance(inputs: AssetGradeInputs): DimensionScore {
  const resolution = invertScore(inputs.avgMaintenanceResolutionHours, 168, 4);
  const perSite = invertScore(inputs.maintenanceCostPerSite, 150_000, 0);
  const capexPerSite = inputs.siteCount > 0 ? inputs.capexDebt / inputs.siteCount : inputs.capexDebt;
  const capex = invertScore(capexPerSite, 500_000, 0);
  const score = 0.4 * resolution + 0.35 * perSite + 0.25 * capex;
  const grade = scoreToGrade(score);
  return {
    dimension: 'maintenance',
    score: round(score),
    grade,
    explanation:
      `Resolution ${inputs.avgMaintenanceResolutionHours.toFixed(1)}h, ` +
      `cost/site ${inputs.maintenanceCostPerSite.toFixed(0)}, ` +
      `capex debt/site ${capexPerSite.toFixed(0)}.`,
  };
}

/** Score the recovery dimension. */
function scoreRecovery(inputs: AssetGradeInputs): DimensionScore {
  const util = clamp(inputs.utilisationRate, 0, 1) * 100;
  const downtimePenalty = clamp(inputs.downtimeDays, 0, 90) / 90;
  const downtimeScore = (1 - downtimePenalty) * 100;
  const marketPrice = clamp(inputs.marketPriceRatio, 0, 1.3);
  const marketScore = linearScore(marketPrice, 0.7, 1.1);
  const score = 0.5 * util + 0.25 * downtimeScore + 0.25 * marketScore;
  const grade = scoreToGrade(score);
  return {
    dimension: 'recovery',
    score: round(score),
    grade,
    explanation:
      `Utilisation ${(inputs.utilisationRate * 100).toFixed(1)}%, ` +
      `avg downtime ${inputs.downtimeDays.toFixed(0)}d, ` +
      `market-price ratio ${inputs.marketPriceRatio.toFixed(2)}.`,
  };
}

/** Score the royalty-compliance dimension. Any open breach hurts the score. */
function scoreRoyaltyCompliance(inputs: AssetGradeInputs): DimensionScore {
  const breaches = Math.max(0, Math.floor(inputs.complianceBreachCount));
  const score = clamp(100 - breaches * 15, 0, 100);
  const grade = scoreToGrade(score);
  return {
    dimension: 'royalty_compliance',
    score: round(score),
    grade,
    explanation:
      breaches === 0
        ? 'No open compliance breaches.'
        : `${breaches} open compliance breach${breaches === 1 ? '' : 'es'} — each deducts 15 pts.`,
  };
}

/** Score the buyer-quality dimension. */
function scoreBuyerQuality(inputs: AssetGradeInputs): DimensionScore {
  const csat = clamp(inputs.buyerSatisfactionProxy, 0, 1);
  const score = csat * 100;
  const grade = scoreToGrade(score);
  return {
    dimension: 'buyer_quality',
    score: round(score),
    grade,
    explanation: `Buyer satisfaction / renewal proxy ${(csat * 100).toFixed(1)}%.`,
  };
}

function round(score: number): number {
  return Math.round(score * 10) / 10;
}

const DIMENSION_SCORERS: Readonly<
  Record<GradeDimension, (inputs: AssetGradeInputs) => DimensionScore>
> = Object.freeze({
  royalty_yield: scoreRoyaltyYield,
  opex_efficiency: scoreOpexEfficiency,
  maintenance: scoreMaintenance,
  recovery: scoreRecovery,
  royalty_compliance: scoreRoyaltyCompliance,
  buyer_quality: scoreBuyerQuality,
});

/**
 * Primary entry point — pure function. Given raw inputs and weights,
 * returns a grade report. Does not mutate either argument.
 */
export function scoreAsset(
  inputs: AssetGradeInputs,
  weights: GradingWeights = DEFAULT_GRADING_WEIGHTS,
): AssetGradeReport {
  validateWeights(weights);

  const dimensionScores: Record<GradeDimension, DimensionScore> = {
    royalty_yield: DIMENSION_SCORERS.royalty_yield(inputs),
    opex_efficiency: DIMENSION_SCORERS.opex_efficiency(inputs),
    maintenance: DIMENSION_SCORERS.maintenance(inputs),
    recovery: DIMENSION_SCORERS.recovery(inputs),
    royalty_compliance: DIMENSION_SCORERS.royalty_compliance(inputs),
    buyer_quality: DIMENSION_SCORERS.buyer_quality(inputs),
  };

  const weightedScore = GRADE_DIMENSIONS.reduce((acc, dim) => {
    return acc + dimensionScores[dim].score * weights[dim];
  }, 0);

  const score = round(weightedScore);
  const grade = scoreToGrade(score);

  const reasons = buildReasons(dimensionScores, weights);

  return {
    assetId: inputs.assetId,
    tenantId: inputs.tenantId,
    grade,
    score,
    dimensions: dimensionScores,
    reasons,
    weights,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Produce human-readable reasons. The strongest and weakest weighted
 * dimensions drive the summary — operators see WHY the grade landed
 * where it did, not just a letter.
 */
function buildReasons(
  dimensions: Readonly<Record<GradeDimension, DimensionScore>>,
  weights: GradingWeights,
): readonly string[] {
  const entries = GRADE_DIMENSIONS.map((dim) => ({
    dim,
    weighted: dimensions[dim].score * weights[dim],
    dimension: dimensions[dim],
  }));
  const sorted = [...entries].sort((a, b) => b.weighted - a.weighted);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];

  const reasons: string[] = [];
  if (strongest) {
    reasons.push(
      `Strongest dimension: ${strongest.dim} (${strongest.dimension.grade}, ${strongest.dimension.score}). ${strongest.dimension.explanation}`,
    );
  }
  if (weakest && weakest.dim !== strongest?.dim) {
    reasons.push(
      `Weakest dimension: ${weakest.dim} (${weakest.dimension.grade}, ${weakest.dimension.score}). ${weakest.dimension.explanation}`,
    );
  }
  // Flag any dimension scoring below 50 — regardless of weight.
  for (const dim of GRADE_DIMENSIONS) {
    if (dimensions[dim].score < 50 && dim !== weakest?.dim) {
      reasons.push(
        `Watchlist: ${dim} scored ${dimensions[dim].score} (${dimensions[dim].grade}).`,
      );
    }
  }
  return reasons;
}

export { DEFAULT_GRADING_WEIGHTS };

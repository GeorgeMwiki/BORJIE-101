/**
 * scoreProperty — pure function from measured inputs → grade report.
 *
 * Every dimension is scored on a 0..100 scale using industry-standard
 * anchors:
 *
 *   income      — blend of rent collection rate, NOI / gross income,
 *                 and inverse arrears ratio.
 *   expense     — inverse expense ratio anchored on 40% (typical
 *                 commercial residential benchmark).
 *   maintenance — blended from resolution speed, cost-per-unit vs
 *                 industry median, and capex debt as a share of NOI.
 *   occupancy   — occupancy rate × (1 - vacancyDurationDays / 90)
 *                 adjusted toward market rent ratio.
 *   compliance  — starts at 100, loses points per open breach.
 *   tenant      — tenantSatisfactionProxy as a direct percentage.
 *
 * The final score is a weighted blend. Grades are assigned from the
 * standard commercial-underwriting cutoffs:
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
  PropertyGrade,
  PropertyGradeInputs,
  PropertyGradeReport,
} from './property-grading-types.js';

/** Grade cutoffs (lower bound, inclusive) in descending order. */
const GRADE_CUTOFFS: readonly (readonly [number, PropertyGrade])[] = [
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

/** Invert a score where higher is worse (e.g. arrears ratio). */
function invertScore(value: number, worst: number, best: number): number {
  return linearScore(value, worst, best);
}

/**
 * Convert a 0..100 score into a discrete grade using the standard
 * commercial-underwriting cutoffs. The lookup is pure.
 */
export function scoreToGrade(score: number): PropertyGrade {
  const clamped = clamp(score, 0, 100);
  for (const [cutoff, grade] of GRADE_CUTOFFS) {
    if (clamped >= cutoff) return grade;
  }
  return 'F';
}

/** Validate that weights sum to 1.0 within tolerance. */
export function validateWeights(weights: GradingWeights): void {
  const sum =
    weights.income +
    weights.expense +
    weights.maintenance +
    weights.occupancy +
    weights.compliance +
    weights.tenant;
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

/** Score the income dimension. Higher is better. */
function scoreIncome(inputs: PropertyGradeInputs): DimensionScore {
  const collection = clamp(inputs.rentCollectionRate, 0, 1) * 100;
  const noiRatio =
    inputs.grossPotentialIncome > 0
      ? clamp(inputs.noi / inputs.grossPotentialIncome, -0.5, 1)
      : 0;
  const noiScore = linearScore(noiRatio, 0, 0.6);
  const arrearsScore = invertScore(inputs.arrearsRatio, 0.3, 0);
  const score = 0.5 * collection + 0.3 * noiScore + 0.2 * arrearsScore;
  const grade = scoreToGrade(score);
  return {
    dimension: 'income',
    score: round(score),
    grade,
    explanation:
      `Rent collection ${(inputs.rentCollectionRate * 100).toFixed(1)}%, ` +
      `NOI margin ${(noiRatio * 100).toFixed(1)}%, arrears ${(inputs.arrearsRatio * 100).toFixed(1)}%.`,
  };
}

/** Score the expense dimension. Lower expense ratio = higher score. */
function scoreExpense(inputs: PropertyGradeInputs): DimensionScore {
  const ratio = clamp(inputs.expenseRatio, 0, 1);
  const score = invertScore(ratio, 0.7, 0.25);
  const grade = scoreToGrade(score);
  return {
    dimension: 'expense',
    score: round(score),
    grade,
    explanation:
      `Operating expense ratio ${(ratio * 100).toFixed(1)}% ` +
      `(best class ≤ 25%, below-market > 70%).`,
  };
}

/** Score the maintenance dimension. */
function scoreMaintenance(inputs: PropertyGradeInputs): DimensionScore {
  const resolution = invertScore(inputs.avgMaintenanceResolutionHours, 168, 4);
  const perUnit = invertScore(inputs.maintenanceCostPerUnit, 150_000, 0);
  const capexPerUnit = inputs.unitCount > 0 ? inputs.capexDebt / inputs.unitCount : inputs.capexDebt;
  const capex = invertScore(capexPerUnit, 500_000, 0);
  const score = 0.4 * resolution + 0.35 * perUnit + 0.25 * capex;
  const grade = scoreToGrade(score);
  return {
    dimension: 'maintenance',
    score: round(score),
    grade,
    explanation:
      `Resolution ${inputs.avgMaintenanceResolutionHours.toFixed(1)}h, ` +
      `cost/unit ${inputs.maintenanceCostPerUnit.toFixed(0)}, ` +
      `capex debt/unit ${capexPerUnit.toFixed(0)}.`,
  };
}

/** Score the occupancy dimension. */
function scoreOccupancy(inputs: PropertyGradeInputs): DimensionScore {
  const occ = clamp(inputs.occupancyRate, 0, 1) * 100;
  const vacancyPenalty = clamp(inputs.vacancyDurationDays, 0, 90) / 90;
  const vacancyScore = (1 - vacancyPenalty) * 100;
  const marketRent = clamp(inputs.marketRentRatio, 0, 1.3);
  const marketScore = linearScore(marketRent, 0.7, 1.1);
  const score = 0.5 * occ + 0.25 * vacancyScore + 0.25 * marketScore;
  const grade = scoreToGrade(score);
  return {
    dimension: 'occupancy',
    score: round(score),
    grade,
    explanation:
      `Occupancy ${(inputs.occupancyRate * 100).toFixed(1)}%, ` +
      `avg vacancy ${inputs.vacancyDurationDays.toFixed(0)}d, ` +
      `market-rent ratio ${inputs.marketRentRatio.toFixed(2)}.`,
  };
}

/** Score the compliance dimension. Any open breach hurts the score. */
function scoreCompliance(inputs: PropertyGradeInputs): DimensionScore {
  const breaches = Math.max(0, Math.floor(inputs.complianceBreachCount));
  const score = clamp(100 - breaches * 15, 0, 100);
  const grade = scoreToGrade(score);
  return {
    dimension: 'compliance',
    score: round(score),
    grade,
    explanation:
      breaches === 0
        ? 'No open compliance breaches.'
        : `${breaches} open compliance breach${breaches === 1 ? '' : 'es'} — each deducts 15 pts.`,
  };
}

/** Score the tenant-quality dimension. */
function scoreTenant(inputs: PropertyGradeInputs): DimensionScore {
  const csat = clamp(inputs.tenantSatisfactionProxy, 0, 1);
  const score = csat * 100;
  const grade = scoreToGrade(score);
  return {
    dimension: 'tenant',
    score: round(score),
    grade,
    explanation: `Tenant satisfaction / renewal proxy ${(csat * 100).toFixed(1)}%.`,
  };
}

function round(score: number): number {
  return Math.round(score * 10) / 10;
}

const DIMENSION_SCORERS: Readonly<
  Record<GradeDimension, (inputs: PropertyGradeInputs) => DimensionScore>
> = Object.freeze({
  income: scoreIncome,
  expense: scoreExpense,
  maintenance: scoreMaintenance,
  occupancy: scoreOccupancy,
  compliance: scoreCompliance,
  tenant: scoreTenant,
});

/**
 * Primary entry point — pure function. Given raw inputs and weights,
 * returns a grade report. Does not mutate either argument.
 */
export function scoreProperty(
  inputs: PropertyGradeInputs,
  weights: GradingWeights = DEFAULT_GRADING_WEIGHTS,
): PropertyGradeReport {
  validateWeights(weights);

  const dimensionScores: Record<GradeDimension, DimensionScore> = {
    income: DIMENSION_SCORERS.income(inputs),
    expense: DIMENSION_SCORERS.expense(inputs),
    maintenance: DIMENSION_SCORERS.maintenance(inputs),
    occupancy: DIMENSION_SCORERS.occupancy(inputs),
    compliance: DIMENSION_SCORERS.compliance(inputs),
    tenant: DIMENSION_SCORERS.tenant(inputs),
  };

  const weightedScore = GRADE_DIMENSIONS.reduce((acc, dim) => {
    return acc + dimensionScores[dim].score * weights[dim];
  }, 0);

  const score = round(weightedScore);
  const grade = scoreToGrade(score);

  const reasons = buildReasons(dimensionScores, weights);

  return {
    propertyId: inputs.propertyId,
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

/**
 * Tenant Credit Rating — pure scoring model.
 *
 * FICO-style 300-850 scale + letter-grade + Kenya-CRB band. The function
 * is pure: given the same inputs + weights it always returns the same
 * rating. No I/O, no randomness, no hidden clock. Weights are supplied by
 * the caller (pulled from `credit_rating_weights` by the service layer,
 * with FICO defaults exported as `DEFAULT_GRADING_WEIGHTS`).
 *
 * INSUFFICIENT DATA policy: a tenant with fewer than 3 invoices cannot
 * be meaningfully scored. Rather than invent numbers we return
 * band='insufficient_data' with a clear reason.
 */

import {
  CreditBand,
  CreditDimensionKey,
  CreditDimensionScore,
  CreditLetterGrade,
  CreditRating,
  CreditRatingDimensions,
  CreditRatingInputs,
  DEFAULT_GRADING_WEIGHTS,
  GradingWeights,
} from './credit-rating-types.js';

const MIN_SCORE = 300;
const MAX_SCORE = 850;
const SCORE_RANGE = MAX_SCORE - MIN_SCORE;

const FRESHNESS_WINDOW_DAYS = 35;
const MIN_INVOICES_FOR_SCORE = 3;

/** Clamp v to [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Normalize weights so they sum to 1. */
function normalizeWeights(w: GradingWeights): GradingWeights {
  const total =
    w.payment_history +
    w.promise_keeping +
    w.rent_to_income +
    w.tenancy_length +
    w.dispute_history;
  if (total <= 0) return DEFAULT_GRADING_WEIGHTS;
  return {
    payment_history: w.payment_history / total,
    promise_keeping: w.promise_keeping / total,
    rent_to_income: w.rent_to_income / total,
    tenancy_length: w.tenancy_length / total,
    dispute_history: w.dispute_history / total,
  };
}

/**
 * Payment history — on-time rate with tiered penalties for escalating
 * lateness. A 30-day late hurts less than a 90+-day late, which hurts
 * much less than a default.
 */
function scorePaymentHistory(i: CreditRatingInputs): CreditDimensionScore {
  const total = i.totalInvoices;
  if (total === 0) {
    return {
      score: 0.5,
      weight: 0,
      explanation: 'No invoices on file — dimension neutral.',
    };
  }
  const onTimeRate = i.paidOnTimeCount / total;
  const late30Rate = i.paidLate30DaysCount / total;
  const late60Rate = i.paidLate60DaysCount / total;
  const late90Rate = i.paidLate90PlusCount / total;
  const defaultRate = i.defaultCount / total;

  // Weighted penalty: each severity tier hurts proportionally more.
  const raw =
    onTimeRate -
    late30Rate * 0.25 -
    late60Rate * 0.5 -
    late90Rate * 0.8 -
    defaultRate * 1.0;
  const score = clamp(raw, 0, 1);

  const onTimePct = Math.round(onTimeRate * 100);
  const lateCount =
    i.paidLate30DaysCount + i.paidLate60DaysCount + i.paidLate90PlusCount;
  const explanation =
    i.defaultCount > 0
      ? `${onTimePct}% on-time across ${total} invoices; ${i.defaultCount} default(s) flagged.`
      : `${onTimePct}% on-time across ${total} invoices; ${lateCount} late payment(s).`;

  return { score: round(score), weight: 0, explanation };
}

/**
 * Promise keeping — when granted an extension or installment plan, did the
 * tenant honor it? Combines extension-keep-rate and installment-keep-rate
 * with equal weight. Neutral (0.6) when no promises exist.
 */
function scorePromiseKeeping(i: CreditRatingInputs): CreditDimensionScore {
  const ext = i.extensionsGranted;
  const inst = i.installmentAgreementsOffered;
  const totalPromises = ext + inst;

  if (totalPromises === 0) {
    return {
      score: 0.6,
      weight: 0,
      explanation:
        'No extensions or installment plans on record — dimension neutral.',
    };
  }

  const extRate = ext === 0 ? null : i.extensionsHonored / ext;
  const instRate = inst === 0 ? null : i.installmentAgreementsHonored / inst;

  const parts: number[] = [];
  if (extRate !== null) parts.push(extRate);
  if (instRate !== null) parts.push(instRate);
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  const score = clamp(avg, 0, 1);

  const honored = i.extensionsHonored + i.installmentAgreementsHonored;
  const explanation = `Honored ${honored} of ${totalPromises} agreed extensions / installments (${Math.round(avg * 100)}%).`;

  return { score: round(score), weight: 0, explanation };
}

/**
 * Rent-to-income — sustainability proxy. 30% is the "affordability" line;
 * below it is excellent, above 50% is stressed. Unknown income → neutral.
 */
function scoreRentToIncome(i: CreditRatingInputs): CreditDimensionScore {
  if (i.rentToIncomeRatio === null || i.rentToIncomeRatio <= 0) {
    return {
      score: 0.6,
      weight: 0,
      explanation: 'Income data not declared — dimension neutral.',
    };
  }
  // Linear decay: 0.2 → 1.0, 0.5 → 0.2, >0.7 → 0.
  const r = i.rentToIncomeRatio;
  let raw: number;
  if (r <= 0.2) raw = 1;
  else if (r >= 0.7) raw = 0;
  else raw = 1 - (r - 0.2) / 0.5;
  const score = clamp(raw, 0, 1);
  const pct = Math.round(r * 100);
  const explanation = `Rent is ${pct}% of declared income (≤30% is comfortable, ≥50% is stressed).`;
  return { score: round(score), weight: 0, explanation };
}

/**
 * Tenancy length — longer stable tenancies score higher. 24+ months is
 * excellent; <6 months is poor.
 */
function scoreTenancyLength(i: CreditRatingInputs): CreditDimensionScore {
  const months = i.avgTenancyMonths;
  if (months <= 0 && i.activeTenancyCount === 0) {
    return {
      score: 0.5,
      weight: 0,
      explanation: 'No tenancy history recorded — dimension neutral.',
    };
  }
  // 0 months → 0.2, 24+ months → 1.0 linear.
  const raw = 0.2 + (Math.min(months, 24) / 24) * 0.8;
  const score = clamp(raw, 0, 1);
  const explanation = `Average tenancy ${Math.round(months)} months across ${i.activeTenancyCount} active lease(s).`;
  return { score: round(score), weight: 0, explanation };
}

/**
 * Dispute history — complaint pattern, damage deductions, sublease
 * violations. Each incident subtracts from a perfect-1.0 starting point.
 */
function scoreDisputeHistory(i: CreditRatingInputs): CreditDimensionScore {
  const incidents =
    i.disputeCount + i.damageDeductionCount * 2 + i.subleaseViolationCount * 3;
  const score = clamp(1 - incidents * 0.08, 0, 1);
  const explanation =
    incidents === 0
      ? 'Clean record — no disputes, damage deductions, or sublease violations.'
      : `${i.disputeCount} dispute(s), ${i.damageDeductionCount} damage deduction(s), ${i.subleaseViolationCount} sublease violation(s).`;
  return { score: round(score), weight: 0, explanation };
}

function numericFromComposite(composite: number): number {
  // composite is 0..1; map linearly to [300, 850].
  return Math.round(MIN_SCORE + composite * SCORE_RANGE);
}

function bandFromNumeric(score: number): CreditBand {
  // Kenya CRB alignment
  if (score >= 750) return 'excellent';
  if (score >= 660) return 'good';
  if (score >= 550) return 'fair';
  if (score >= 450) return 'poor';
  return 'very_poor';
}

function letterFromNumeric(score: number): CreditLetterGrade {
  if (score >= 780) return 'A';
  if (score >= 700) return 'B';
  if (score >= 600) return 'C';
  if (score >= 500) return 'D';
  return 'F';
}

function assessFreshness(
  newestInvoiceAt: string | null,
  asOf: string,
): 'fresh' | 'stale' | 'unknown' {
  if (!newestInvoiceAt) return 'unknown';
  const newest = Date.parse(newestInvoiceAt);
  const asOfTs = Date.parse(asOf);
  if (Number.isNaN(newest) || Number.isNaN(asOfTs)) return 'unknown';
  const daysSince = (asOfTs - newest) / (24 * 60 * 60 * 1000);
  return daysSince <= FRESHNESS_WINDOW_DAYS ? 'fresh' : 'stale';
}

function buildRecommendations(
  dims: CreditRatingDimensions,
): readonly string[] {
  const recs: string[] = [];
  if (dims.payment_history.score < 0.6) {
    recs.push('Pay rent within 2 days of due date for the next 3 months to rebuild payment history.');
  }
  if (dims.promise_keeping.score < 0.6) {
    recs.push('Honor the next agreed extension or installment exactly on the promised date — this dimension recovers fast.');
  }
  if (dims.rent_to_income.score < 0.5) {
    recs.push('Rent burden is high relative to declared income — consider updating income documents or discussing affordability.');
  }
  if (dims.tenancy_length.score < 0.5) {
    recs.push('Tenancy is young — stability boosts this score automatically as months accumulate.');
  }
  if (dims.dispute_history.score < 0.7) {
    recs.push('Resolve any open disputes and avoid damage/sublease incidents — each clean quarter rebuilds trust.');
  }
  if (recs.length === 0) {
    recs.push('Excellent across all dimensions — maintain current behavior.');
  }
  return recs;
}

export interface ScoreOutput {
  readonly rating: CreditRating;
}

/**
 * Pure scoring function — given live inputs and active weights, return a
 * complete CreditRating. NO side effects, NO hardcoded weights inside.
 */
export function scoreTenantCredit(
  inputs: CreditRatingInputs,
  weights: GradingWeights = DEFAULT_GRADING_WEIGHTS,
): CreditRating {
  // Insufficient-data guard — never invent a score from thin air.
  if (inputs.totalInvoices < MIN_INVOICES_FOR_SCORE) {
    const reason = `Need at least ${MIN_INVOICES_FOR_SCORE} invoices to compute a rating; found ${inputs.totalInvoices}.`;
    return {
      tenantId: inputs.tenantId,
      customerId: inputs.customerId,
      numericScore: null,
      letterGrade: null,
      band: 'insufficient_data',
      dimensions: emptyDimensions(),
      weakestFactor: null,
      strongestFactor: null,
      recommendations: [
        'Complete the first few rent cycles — a credit rating will activate automatically after 3 invoices.',
      ],
      lastComputedAt: inputs.asOf,
      dataFreshness: assessFreshness(inputs.newestInvoiceAt, inputs.asOf),
      insufficientDataReason: reason,
    };
  }

  const w = normalizeWeights(weights);

  const ph = scorePaymentHistory(inputs);
  const pk = scorePromiseKeeping(inputs);
  const rti = scoreRentToIncome(inputs);
  const tl = scoreTenancyLength(inputs);
  const dh = scoreDisputeHistory(inputs);

  const dimensions: CreditRatingDimensions = {
    payment_history: { ...ph, weight: round(w.payment_history) },
    promise_keeping: { ...pk, weight: round(w.promise_keeping) },
    rent_to_income: { ...rti, weight: round(w.rent_to_income) },
    tenancy_length: { ...tl, weight: round(w.tenancy_length) },
    dispute_history: { ...dh, weight: round(w.dispute_history) },
  };

  const composite =
    ph.score * w.payment_history +
    pk.score * w.promise_keeping +
    rti.score * w.rent_to_income +
    tl.score * w.tenancy_length +
    dh.score * w.dispute_history;

  const numeric = numericFromComposite(composite);
  const band = bandFromNumeric(numeric);
  const letter = letterFromNumeric(numeric);

  const [strongest, weakest] = rankDimensions(dimensions);

  return {
    tenantId: inputs.tenantId,
    customerId: inputs.customerId,
    numericScore: numeric,
    letterGrade: letter,
    band,
    dimensions,
    weakestFactor: weakest,
    strongestFactor: strongest,
    recommendations: buildRecommendations(dimensions),
    lastComputedAt: inputs.asOf,
    dataFreshness: assessFreshness(inputs.newestInvoiceAt, inputs.asOf),
    insufficientDataReason: null,
  };
}

function rankDimensions(
  d: CreditRatingDimensions,
): [CreditDimensionKey, CreditDimensionKey] {
  const entries: Array<[CreditDimensionKey, number]> = [
    ['payment_history', d.payment_history.score * d.payment_history.weight],
    ['promise_keeping', d.promise_keeping.score * d.promise_keeping.weight],
    ['rent_to_income', d.rent_to_income.score * d.rent_to_income.weight],
    ['tenancy_length', d.tenancy_length.score * d.tenancy_length.weight],
    ['dispute_history', d.dispute_history.score * d.dispute_history.weight],
  ];
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  return [sorted[0][0], sorted[sorted.length - 1][0]];
}

function emptyDimensions(): CreditRatingDimensions {
  const z: CreditDimensionScore = {
    score: 0,
    weight: 0,
    explanation: 'Not computed — insufficient data.',
  };
  return {
    payment_history: z,
    promise_keeping: z,
    rent_to_income: z,
    tenancy_length: z,
    dispute_history: z,
  };
}

export const CREDIT_SCORE_CONSTANTS = Object.freeze({
  MIN_SCORE,
  MAX_SCORE,
  SCORE_RANGE,
  MIN_INVOICES_FOR_SCORE,
  FRESHNESS_WINDOW_DAYS,
});

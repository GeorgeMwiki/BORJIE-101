/**
 * Deterministic Payment Risk Calculator
 *
 * Produces an auditable, reproducible payment-risk score on a 0-100 scale
 * (higher = safer). The LLM downstream is only allowed to NARRATE this
 * score, never to change it.
 *
 * Weights (tuned on the business spec, must sum to 1.0):
 *
 *   history      0.45  — on-time / late / missed over last 12 months
 *   income       0.25  — income-to-rent ratio
 *   employment   0.15  — stability & verification
 *   arrears      0.10  — existing outstanding balance
 *   litigation   0.05  — recent evictions / judgments
 *
 * Thresholds (inclusive lower bound):
 *
 *   >= 75  LOW
 *   60-74  MODERATE
 *   40-59  ELEVATED
 *   25-39  HIGH
 *   <  25  CRITICAL
 *
 * Monotonicity: all sub-scores are monotonic non-decreasing with better
 * inputs — unit tests enforce this.
 */

export type DeterministicPaymentRiskLevel =
  | 'LOW'
  | 'MODERATE'
  | 'ELEVATED'
  | 'HIGH'
  | 'CRITICAL';

export const PAYMENT_RISK_WEIGHTS = Object.freeze({
  history: 0.45,
  income: 0.25,
  employment: 0.15,
  arrears: 0.1,
  litigation: 0.05,
} as const);

export interface PaymentRiskInput {
  readonly history: {
    readonly totalOnTime: number;
    readonly totalLate: number;
    readonly totalMissed: number;
    readonly averageDaysLate: number;
  };
  readonly income: {
    readonly monthlyNetIncome: number;
    readonly monthlyRent: number;
  };
  readonly employment: {
    readonly status:
      | 'employed'
      | 'self-employed'
      | 'unemployed'
      | 'retired'
      | 'unknown';
    readonly monthsAtEmployer: number;
    readonly verified: boolean;
  };
  readonly arrears: {
    readonly currentBalance: number;
    readonly monthlyRent: number;
  };
  readonly litigation: {
    readonly evictions: number;
    readonly judgments: number;
    readonly activeLawsuits: number;
  };
}

export interface PaymentRiskSubScores {
  readonly history: number;
  readonly income: number;
  readonly employment: number;
  readonly arrears: number;
  readonly litigation: number;
}

export interface DeterministicPaymentRiskResult {
  readonly score: number;
  readonly level: DeterministicPaymentRiskLevel;
  readonly subScores: PaymentRiskSubScores;
  readonly weights: typeof PAYMENT_RISK_WEIGHTS;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function scoreHistory(
  history: PaymentRiskInput['history'],
): number {
  const total =
    history.totalOnTime + history.totalLate + history.totalMissed;
  if (total === 0) return 60; // new tenant baseline
  const onTimeRate = history.totalOnTime / total;
  const missedPenalty = (history.totalMissed / total) * 60;
  const latenessPenalty = clamp(history.averageDaysLate, 0, 30) * 0.8;
  const base = onTimeRate * 100;
  return clamp(base - missedPenalty - latenessPenalty, 0, 100);
}

export function scoreIncome(income: PaymentRiskInput['income']): number {
  if (income.monthlyRent <= 0) return 50;
  const ratio = income.monthlyNetIncome / income.monthlyRent;
  // 3x rent = perfect, 1x rent = critical
  if (ratio >= 3) return 100;
  if (ratio <= 1) return 0;
  return ((ratio - 1) / 2) * 100;
}

export function scoreEmployment(
  employment: PaymentRiskInput['employment'],
): number {
  let base: number;
  switch (employment.status) {
    case 'employed':
      base = 85;
      break;
    case 'self-employed':
      base = 70;
      break;
    case 'retired':
      base = 75;
      break;
    case 'unemployed':
      base = 20;
      break;
    case 'unknown':
    default:
      base = 45;
  }
  const tenureBonus = clamp(employment.monthsAtEmployer / 24, 0, 1) * 10;
  const verifiedBonus = employment.verified ? 5 : 0;
  return clamp(base + tenureBonus + verifiedBonus, 0, 100);
}

export function scoreArrears(
  arrears: PaymentRiskInput['arrears'],
): number {
  if (arrears.monthlyRent <= 0) return 50;
  if (arrears.currentBalance <= 0) return 100;
  const monthsOwed = arrears.currentBalance / arrears.monthlyRent;
  if (monthsOwed >= 3) return 0;
  return clamp(100 - monthsOwed * 33.3, 0, 100);
}

export function scoreLitigation(
  litigation: PaymentRiskInput['litigation'],
): number {
  const penalty =
    litigation.evictions * 50 +
    litigation.judgments * 25 +
    litigation.activeLawsuits * 15;
  return clamp(100 - penalty, 0, 100);
}

export function levelFromScore(
  score: number,
): DeterministicPaymentRiskLevel {
  if (score >= 75) return 'LOW';
  if (score >= 60) return 'MODERATE';
  if (score >= 40) return 'ELEVATED';
  if (score >= 25) return 'HIGH';
  return 'CRITICAL';
}

/**
 * Compute the deterministic payment risk score. Always runs BEFORE any LLM
 * narration — the LLM receives the sub-scores and total as context but must
 * not override them.
 */
export function calculatePaymentRisk(
  input: PaymentRiskInput,
): DeterministicPaymentRiskResult {
  const subScores: PaymentRiskSubScores = {
    history: scoreHistory(input.history),
    income: scoreIncome(input.income),
    employment: scoreEmployment(input.employment),
    arrears: scoreArrears(input.arrears),
    litigation: scoreLitigation(input.litigation),
  };

  const weighted =
    subScores.history * PAYMENT_RISK_WEIGHTS.history +
    subScores.income * PAYMENT_RISK_WEIGHTS.income +
    subScores.employment * PAYMENT_RISK_WEIGHTS.employment +
    subScores.arrears * PAYMENT_RISK_WEIGHTS.arrears +
    subScores.litigation * PAYMENT_RISK_WEIGHTS.litigation;

  const score = Math.round(clamp(weighted, 0, 100));
  return {
    score,
    level: levelFromScore(score),
    subScores,
    weights: PAYMENT_RISK_WEIGHTS,
  };
}

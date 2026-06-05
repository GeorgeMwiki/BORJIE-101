/**
 * Counterparty risk model — pre-engagement risk classifier that fuses
 * traditional credit data, employment signal, past-suspension record,
 * and alternative-data score into an engagement recommendation.
 *
 * Phase D D10 — Comprehensive Gap Closure (Sub-feature 6 of 6).
 *
 * Why this matters: AI-driven pre-engagement screening is the single
 * largest driver of operator-default reduction in mining literature.
 * The recommendation flows BACK into the licence-suspension-decision
 * path at `platform.suspend_licence.ts` — a strong screening signal at
 * offtake issuance materially lowers the probability that the same
 * counterparty ever reaches the suspension tool 18 months later.
 *
 * Output recommendations:
 *   - `accept`              — risk score in the safe band
 *   - `accept-with-deposit` — moderate risk; require deposit uplift
 *   - `decline`             — high risk; reject the application
 *
 * The model is a pure deterministic transform — no LLM, no external
 * calls. All inputs are caller-provided so the function is fully
 * testable from synthetic data.
 */

import { z } from 'zod';
import type { CreditBand } from '../credit-scoring/alt-data-credit-model.js';

// ─────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────

export const EmploymentSignalSchema = z.object({
  /** Months of continuous employment at the current employer. */
  monthsAtCurrent: z.number().int().nonnegative(),
  /** Stated monthly income in TZS cents (caller normalises). */
  monthlyIncomeCents: z.number().int().nonnegative(),
  /** Employer verification flag. */
  employerVerified: z.boolean(),
});

export const PastSuspensionRecordSchema = z.object({
  suspensionsLast5y: z.number().int().nonnegative(),
  /** Whether the counterparty paid the outstanding royalties post-suspension. */
  outstandingSettled: z.boolean(),
});

export const ScreeningInputSchema = z.object({
  tenantId: z.string().min(1).max(64),
  applicantId: z.string().min(1).max(64),
  /** Traditional credit-history score in [0, 1000]. */
  creditHistoryScore: z.number().int().min(0).max(1000),
  /** Alt-data score from `createAltCreditService.score`. In [0, 1000]. */
  altCreditScore: z.number().int().min(0).max(1000),
  /** Monthly payment the applicant would owe, same currency as income. */
  proposedMonthlyPaymentCents: z.number().int().nonnegative(),
  employment: EmploymentSignalSchema,
  suspensionRecord: PastSuspensionRecordSchema,
});

export type EmploymentSignal = z.infer<typeof EmploymentSignalSchema>;
export type PastSuspensionRecord = z.infer<typeof PastSuspensionRecordSchema>;
export type ScreeningInput = z.infer<typeof ScreeningInputSchema>;

export type ScreeningRecommendation =
  | 'accept'
  | 'accept-with-deposit'
  | 'decline';

export interface ScreeningResult {
  readonly tenantId: string;
  readonly applicantId: string;
  readonly riskScore: number;
  readonly band: CreditBand;
  readonly recommendation: ScreeningRecommendation;
  /** Suggested deposit multiplier (e.g. 1 = one month, 2 = two months). */
  readonly suggestedDepositMonths: number;
  /** Reason codes contributing to the recommendation — for audit + dashboards. */
  readonly reasons: ReadonlyArray<string>;
  readonly modelVersion: string;
}

export const SCREENING_MODEL_VERSION = 'screening-v1';

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────

/**
 * Standard payment-to-income ceiling. 33% is the canonical
 * "healthy" threshold; >40% is high-risk; >50% triggers decline.
 */
const PAYMENT_TO_INCOME_HEALTHY = 0.33;
const PAYMENT_TO_INCOME_HIGH = 0.40;
const PAYMENT_TO_INCOME_DECLINE = 0.50;

// ─────────────────────────────────────────────────────────────────────
// Pure functions
// ─────────────────────────────────────────────────────────────────────

/**
 * Compute the payment-to-income ratio. Returns 1.0 (worst possible) if
 * income is zero so the downstream rules treat unemployed applicants
 * as decline-band.
 */
export function paymentToIncome(input: {
  proposedMonthlyPaymentCents: number;
  monthlyIncomeCents: number;
}): number {
  if (input.monthlyIncomeCents <= 0) return 1;
  return Math.min(1, input.proposedMonthlyPaymentCents / input.monthlyIncomeCents);
}

/**
 * Blended risk score in [0, 1000]. Higher = safer.
 *
 *   - 40% credit-history score
 *   - 30% alt-data score
 *   - 20% payment-to-income inversion (1 - r) * 1000, clamped
 *   - 10% employment stability (months-capped at 24, scaled)
 *
 * Suspension history applies a HARD deduction (200 points per prior
 * suspension, max -400) before the band classification.
 */
export function computeRiskScore(input: ScreeningInput): number {
  const r = paymentToIncome({
    proposedMonthlyPaymentCents: input.proposedMonthlyPaymentCents,
    monthlyIncomeCents: input.employment.monthlyIncomeCents,
  });
  const rtiScore = (1 - r) * 1000;
  const employmentScore =
    Math.min(24, input.employment.monthsAtCurrent) * (1000 / 24) *
      (input.employment.employerVerified ? 1 : 0.7);

  const blended =
    input.creditHistoryScore * 0.4 +
    input.altCreditScore * 0.3 +
    rtiScore * 0.2 +
    employmentScore * 0.1;

  const suspensionPenalty = Math.min(400, input.suspensionRecord.suspensionsLast5y * 200);
  const settledOffset = input.suspensionRecord.outstandingSettled ? 50 : 0;
  // Verified-employer bonus — strong signal of payment reliability.
  // An employer-verified applicant outperforms a same-income unverified
  // applicant by ~30 points on the blended-credit scale.
  const employerVerifiedBonus = input.employment.employerVerified ? 30 : 0;

  return Math.max(
    0,
    Math.min(
      1000,
      Math.round(
        blended - suspensionPenalty + settledOffset + employerVerifiedBonus,
      ),
    ),
  );
}

function bandFor(score: number): CreditBand {
  if (score >= 800) return 'excellent';
  if (score >= 650) return 'good';
  if (score >= 450) return 'fair';
  return 'poor';
}

/**
 * Build the recommendation from a risk score + the underlying signals.
 * Returns reason codes alongside the recommendation for transparency.
 */
export function recommend(input: ScreeningInput): ScreeningResult {
  const parsed = ScreeningInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `screening: invalid input — ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }

  const r = paymentToIncome({
    proposedMonthlyPaymentCents: input.proposedMonthlyPaymentCents,
    monthlyIncomeCents: input.employment.monthlyIncomeCents,
  });
  const riskScore = computeRiskScore(input);
  const band = bandFor(riskScore);
  const reasons: string[] = [];

  // Hard-decline rules (override score).
  if (r >= PAYMENT_TO_INCOME_DECLINE) {
    reasons.push(`payment-to-income ${(r * 100).toFixed(0)}% exceeds 50% ceiling`);
    return {
      tenantId: input.tenantId,
      applicantId: input.applicantId,
      riskScore,
      band,
      recommendation: 'decline',
      suggestedDepositMonths: 0,
      reasons,
      modelVersion: SCREENING_MODEL_VERSION,
    };
  }
  if (input.suspensionRecord.suspensionsLast5y >= 2) {
    reasons.push(`${input.suspensionRecord.suspensionsLast5y} suspensions in 5y`);
    return {
      tenantId: input.tenantId,
      applicantId: input.applicantId,
      riskScore,
      band,
      recommendation: 'decline',
      suggestedDepositMonths: 0,
      reasons,
      modelVersion: SCREENING_MODEL_VERSION,
    };
  }

  // Score-driven recommendation.
  let recommendation: ScreeningRecommendation = 'accept';
  let depositMonths = 1;
  if (band === 'poor') {
    recommendation = 'decline';
    depositMonths = 0;
    reasons.push(`risk band poor (score ${riskScore})`);
  } else if (band === 'fair') {
    recommendation = 'accept-with-deposit';
    depositMonths = 2;
    reasons.push(`risk band fair (score ${riskScore})`);
  } else if (band === 'good') {
    recommendation = 'accept';
    depositMonths = 1;
    reasons.push(`risk band good (score ${riskScore})`);
  } else {
    recommendation = 'accept';
    depositMonths = 1;
    reasons.push(`risk band excellent (score ${riskScore})`);
  }

  // Conditional uplifts.
  if (recommendation === 'accept' && r >= PAYMENT_TO_INCOME_HIGH) {
    recommendation = 'accept-with-deposit';
    depositMonths = Math.max(depositMonths, 2);
    reasons.push(`payment-to-income ${(r * 100).toFixed(0)}% exceeds 40%`);
  }
  if (recommendation !== 'decline' && r < PAYMENT_TO_INCOME_HEALTHY) {
    reasons.push(`payment-to-income ${(r * 100).toFixed(0)}% within healthy band`);
  }
  if (input.suspensionRecord.suspensionsLast5y === 1) {
    if (recommendation === 'accept') {
      recommendation = 'accept-with-deposit';
      depositMonths = Math.max(depositMonths, 2);
    }
    reasons.push('1 prior suspension in 5y');
    if (input.suspensionRecord.outstandingSettled) {
      reasons.push('outstanding royalties settled — partial mitigant');
    }
  }
  if (!input.employment.employerVerified) {
    if (recommendation === 'accept') {
      recommendation = 'accept-with-deposit';
      depositMonths = Math.max(depositMonths, 2);
    }
    reasons.push('employer not verified');
  }

  return {
    tenantId: input.tenantId,
    applicantId: input.applicantId,
    riskScore,
    band,
    recommendation,
    suggestedDepositMonths: depositMonths,
    reasons,
    modelVersion: SCREENING_MODEL_VERSION,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Suspension-decision feedback port
// ─────────────────────────────────────────────────────────────────────

/**
 * When the licence-suspension-decision flow at
 * `platform.suspend_licence.ts` is being considered, the executor SHOULD
 * call this helper to fold the historical screening result into the
 * decision. A weak screening result combined with an in-flight suspension
 * is exactly what we want the model to learn from — call sites stash the
 * screening result on the offtake record so it can be retrieved here.
 */
export interface ScreeningFeedbackInput {
  readonly screeningRecommendation: ScreeningRecommendation;
  readonly screeningRiskScore: number;
  readonly suspensionStage: 'pre-action' | 'action-issued' | 'escalation-initiated';
}

export interface ScreeningFeedbackResult {
  /** Cautionary flag for the suspension approver UI. */
  readonly cautionFlag: boolean;
  /** Plain-English reason for the auditor. */
  readonly reason: string;
}

/**
 * Pure helper — given a candidate offtake's prior screening outcome and
 * the current suspension stage, decide whether to flag the suspension
 * with a "screening-was-strong" caution. A strong-screening suspension
 * indicates either a model failure or an unusual circumstance — both
 * warrant extra HIL scrutiny.
 */
export function adviseSuspension(
  input: ScreeningFeedbackInput,
): ScreeningFeedbackResult {
  if (
    input.screeningRecommendation === 'accept' &&
    input.screeningRiskScore >= 750 &&
    input.suspensionStage !== 'pre-action'
  ) {
    return {
      cautionFlag: true,
      reason: `offtake was screened ACCEPT with risk score ${input.screeningRiskScore} — investigate model drift / extenuating circumstances before proceeding`,
    };
  }
  if (input.screeningRecommendation === 'decline') {
    return {
      cautionFlag: false,
      reason:
        'offtake was screened DECLINE — suspension is consistent with the original risk assessment',
    };
  }
  return {
    cautionFlag: false,
    reason: 'screening signal within expected band',
  };
}

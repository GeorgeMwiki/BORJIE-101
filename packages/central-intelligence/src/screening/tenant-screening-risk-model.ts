/**
 * Tenant screening risk model — pre-leasing risk classifier that fuses
 * traditional credit data, employment signal, past-eviction record,
 * and alternative-data score into a leasing recommendation.
 *
 * Phase D D10 — Comprehensive Gap Closure (Sub-feature 6 of 6).
 *
 * Why this matters: AI-driven pre-leasing screening is the single
 * largest driver of eviction-rate reduction in US PropTech literature
 * (Latch / Findigs / SafeRent report 35-50% drops). The recommendation
 * flows BACK into the eviction-decision path at
 * `platform.evict_tenant.ts` — a strong screening signal at lease
 * issuance materially lowers the probability that the same lease ever
 * reaches the eviction tool 18 months later.
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
  /** Stated monthly income in TZS cents (or KES cents — caller normalises). */
  monthlyIncomeCents: z.number().int().nonnegative(),
  /** Employer verification flag. */
  employerVerified: z.boolean(),
});

export const PastEvictionRecordSchema = z.object({
  evictionsLast5y: z.number().int().nonnegative(),
  /** Whether the candidate paid the arrears post-eviction. */
  arrearsSettled: z.boolean(),
});

export const ScreeningInputSchema = z.object({
  tenantId: z.string().min(1).max(64),
  applicantId: z.string().min(1).max(64),
  /** Traditional rent-history credit score in [0, 1000]. */
  rentHistoryScore: z.number().int().min(0).max(1000),
  /** Alt-data score from `createAltCreditService.score`. In [0, 1000]. */
  altCreditScore: z.number().int().min(0).max(1000),
  /** Monthly rent the applicant would pay, same currency as income. */
  proposedMonthlyRentCents: z.number().int().nonnegative(),
  employment: EmploymentSignalSchema,
  evictionRecord: PastEvictionRecordSchema,
});

export type EmploymentSignal = z.infer<typeof EmploymentSignalSchema>;
export type PastEvictionRecord = z.infer<typeof PastEvictionRecordSchema>;
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
 * Standard PropTech rent-to-income ceiling. 33% is the canonical
 * "healthy" threshold; >40% is high-risk; >50% triggers decline.
 */
const RENT_TO_INCOME_HEALTHY = 0.33;
const RENT_TO_INCOME_HIGH = 0.40;
const RENT_TO_INCOME_DECLINE = 0.50;

// ─────────────────────────────────────────────────────────────────────
// Pure functions
// ─────────────────────────────────────────────────────────────────────

/**
 * Compute the rent-to-income ratio. Returns 1.0 (worst possible) if
 * income is zero so the downstream rules treat unemployed applicants
 * as decline-band.
 */
export function rentToIncome(input: {
  proposedMonthlyRentCents: number;
  monthlyIncomeCents: number;
}): number {
  if (input.monthlyIncomeCents <= 0) return 1;
  return Math.min(1, input.proposedMonthlyRentCents / input.monthlyIncomeCents);
}

/**
 * Blended risk score in [0, 1000]. Higher = safer.
 *
 *   - 40% rent-history score
 *   - 30% alt-data score
 *   - 20% rent-to-income inversion (1 - r) * 1000, clamped
 *   - 10% employment stability (months-capped at 24, scaled)
 *
 * Eviction history applies a HARD deduction (200 points per prior
 * eviction, max -400) before the band classification.
 */
export function computeRiskScore(input: ScreeningInput): number {
  const r = rentToIncome({
    proposedMonthlyRentCents: input.proposedMonthlyRentCents,
    monthlyIncomeCents: input.employment.monthlyIncomeCents,
  });
  const rtiScore = (1 - r) * 1000;
  const employmentScore =
    Math.min(24, input.employment.monthsAtCurrent) * (1000 / 24) *
      (input.employment.employerVerified ? 1 : 0.7);

  const blended =
    input.rentHistoryScore * 0.4 +
    input.altCreditScore * 0.3 +
    rtiScore * 0.2 +
    employmentScore * 0.1;

  const evictionPenalty = Math.min(400, input.evictionRecord.evictionsLast5y * 200);
  const settledOffset = input.evictionRecord.arrearsSettled ? 50 : 0;
  // Verified-employer bonus — strong signal of payment reliability.
  // Mirrors the SafeRent / Findigs heuristic that an employer-verified
  // applicant outperforms a same-income unverified applicant by ~30
  // points on the blended-credit scale.
  const employerVerifiedBonus = input.employment.employerVerified ? 30 : 0;

  return Math.max(
    0,
    Math.min(
      1000,
      Math.round(
        blended - evictionPenalty + settledOffset + employerVerifiedBonus,
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

  const r = rentToIncome({
    proposedMonthlyRentCents: input.proposedMonthlyRentCents,
    monthlyIncomeCents: input.employment.monthlyIncomeCents,
  });
  const riskScore = computeRiskScore(input);
  const band = bandFor(riskScore);
  const reasons: string[] = [];

  // Hard-decline rules (override score).
  if (r >= RENT_TO_INCOME_DECLINE) {
    reasons.push(`rent-to-income ${(r * 100).toFixed(0)}% exceeds 50% ceiling`);
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
  if (input.evictionRecord.evictionsLast5y >= 2) {
    reasons.push(`${input.evictionRecord.evictionsLast5y} evictions in 5y`);
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
  if (recommendation === 'accept' && r >= RENT_TO_INCOME_HIGH) {
    recommendation = 'accept-with-deposit';
    depositMonths = Math.max(depositMonths, 2);
    reasons.push(`rent-to-income ${(r * 100).toFixed(0)}% exceeds 40%`);
  }
  if (recommendation !== 'decline' && r < RENT_TO_INCOME_HEALTHY) {
    reasons.push(`rent-to-income ${(r * 100).toFixed(0)}% within healthy band`);
  }
  if (input.evictionRecord.evictionsLast5y === 1) {
    if (recommendation === 'accept') {
      recommendation = 'accept-with-deposit';
      depositMonths = Math.max(depositMonths, 2);
    }
    reasons.push('1 prior eviction in 5y');
    if (input.evictionRecord.arrearsSettled) {
      reasons.push('arrears settled — partial mitigant');
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
// Eviction-decision feedback port
// ─────────────────────────────────────────────────────────────────────

/**
 * When the eviction-decision flow at `platform.evict_tenant.ts` is
 * being considered, the executor SHOULD call this helper to fold the
 * historical screening result into the decision. A weak screening
 * result combined with an in-flight eviction is exactly what we want
 * the model to learn from — call sites stash the screening result on
 * the lease record so it can be retrieved here.
 */
export interface ScreeningFeedbackInput {
  readonly screeningRecommendation: ScreeningRecommendation;
  readonly screeningRiskScore: number;
  readonly evictionStage: 'pre-notice' | 'notice-issued' | 'writ-requested';
}

export interface ScreeningFeedbackResult {
  /** Cautionary flag for the eviction approver UI. */
  readonly cautionFlag: boolean;
  /** Plain-English reason for the auditor. */
  readonly reason: string;
}

/**
 * Pure helper — given a candidate lease's prior screening outcome and
 * the current eviction stage, decide whether to flag the eviction
 * with a "screening-was-strong" caution. A strong-screening eviction
 * indicates either a model failure or an unusual circumstance — both
 * warrant extra HIL scrutiny.
 */
export function adviseEviction(
  input: ScreeningFeedbackInput,
): ScreeningFeedbackResult {
  if (
    input.screeningRecommendation === 'accept' &&
    input.screeningRiskScore >= 750 &&
    input.evictionStage !== 'pre-notice'
  ) {
    return {
      cautionFlag: true,
      reason: `lease was screened ACCEPT with risk score ${input.screeningRiskScore} — investigate model drift / extenuating circumstances before proceeding`,
    };
  }
  if (input.screeningRecommendation === 'decline') {
    return {
      cautionFlag: false,
      reason:
        'lease was screened DECLINE — eviction is consistent with the original risk assessment',
    };
  }
  return {
    cautionFlag: false,
    reason: 'screening signal within expected band',
  };
}

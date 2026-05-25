/**
 * Alternative-data tenant credit scoring model.
 *
 * Phase D D10 — Comprehensive Gap Closure (Sub-feature 4 of 6).
 *
 * Combines three structural cash-flow signals that EXISTING US PropTech
 * credit-bureau adapters do not capture (because the underlying data
 * does not exist in the US FCRA tradeline universe):
 *
 *   1. M-Pesa cash-flow signal — transaction frequency over the last
 *      30 days + distinct-recipients count (proxies for income
 *      stability + social/economic embeddedness).
 *   2. Utility-payment-on-time rate — observed utility payments and
 *      how many were paid by the due date (proxy for bill discipline).
 *   3. Employer-payroll regularity — observed pay periods and how many
 *      arrived on the expected schedule (proxy for income reliability).
 *
 * Each signal normalises to [0, 1000]. The model output is a weighted
 * blend with a band classification matching the rent-history rating's
 * `poor | fair | good | excellent` taxonomy so downstream consumers
 * can blend the two ratings without remapping.
 *
 * Privacy note: the model NEVER stores PII. Only normalised counts
 * and the resulting score land in the `alt_credit_scores` table.
 */

import { z } from 'zod';

/**
 * Structural port for the M-Pesa adapter — the alt-data model only
 * needs a hook to refresh cash-flow signal on demand. Mirrors the
 * shape from `@borjie/connectors` `MpesaAdapter` so the
 * composition root can wire the real adapter without a cross-package
 * type dependency.
 */
export interface MpesaAdapterPort {
  readonly connector: { readonly id: string };
}

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export type CreditBand = 'poor' | 'fair' | 'good' | 'excellent';

export const ALT_CREDIT_MODEL_VERSION = 'alt-data-v1';

export const MpesaCashflowSignalSchema = z.object({
  /** Number of M-Pesa transactions in the trailing 30 days. */
  txCount30d: z.number().int().nonnegative(),
  /** Distinct recipients (counterparties) seen in 30d window. */
  distinctRecipients: z.number().int().nonnegative(),
});

export const UtilityPaymentSignalSchema = z.object({
  paymentsObserved: z.number().int().nonnegative(),
  paymentsOnTime: z.number().int().nonnegative(),
});

export const PayrollSignalSchema = z.object({
  periodsObserved: z.number().int().nonnegative(),
  periodsOnSchedule: z.number().int().nonnegative(),
});

export const AltCreditInputSchema = z.object({
  tenantId: z.string().min(1).max(64),
  customerId: z.string().min(1).max(64),
  mpesa: MpesaCashflowSignalSchema,
  utility: UtilityPaymentSignalSchema,
  payroll: PayrollSignalSchema,
});

export type MpesaCashflowSignal = z.infer<typeof MpesaCashflowSignalSchema>;
export type UtilityPaymentSignal = z.infer<typeof UtilityPaymentSignalSchema>;
export type PayrollSignal = z.infer<typeof PayrollSignalSchema>;
export type AltCreditInput = z.infer<typeof AltCreditInputSchema>;

export interface AltCreditScore {
  readonly tenantId: string;
  readonly customerId: string;
  readonly score: number;
  readonly band: CreditBand;
  readonly subScores: {
    readonly mpesaCashflow: number;
    readonly utilityOnTime: number;
    readonly payrollRegularity: number;
  };
  readonly modelVersion: string;
  readonly computedAt: string;
}

// ─────────────────────────────────────────────────────────────────────
// Weights — sum to 1.0. Empirically chosen so payroll dominates when
// observed (income stability is the single strongest signal in East
// Africa), then M-Pesa cash-flow, then utility on-time.
// ─────────────────────────────────────────────────────────────────────

export interface AltCreditWeights {
  readonly mpesaCashflow: number;
  readonly utilityOnTime: number;
  readonly payrollRegularity: number;
}

export const DEFAULT_ALT_CREDIT_WEIGHTS: AltCreditWeights = Object.freeze({
  mpesaCashflow: 0.30,
  utilityOnTime: 0.25,
  payrollRegularity: 0.45,
});

// ─────────────────────────────────────────────────────────────────────
// Sub-scoring helpers — each returns an integer in [0, 1000]
// ─────────────────────────────────────────────────────────────────────

/**
 * M-Pesa cash-flow → [0,1000].
 * 30 tx/month or more = saturate at 1000. 0 tx = 0.
 * Distinct recipients adds a multiplier in [0.7, 1.3] — solo-counterparty
 * accounts (gambling, single-recipient) score lower than diverse usage.
 */
export function scoreMpesaCashflow(signal: MpesaCashflowSignal): number {
  const txComponent = Math.min(1, signal.txCount30d / 30);
  const recipBase = Math.min(1, signal.distinctRecipients / 10);
  // Map [0,1] → [0.7, 1.3] linearly.
  const recipMultiplier = 0.7 + 0.6 * recipBase;
  return Math.round(Math.min(1000, txComponent * 1000 * recipMultiplier));
}

/**
 * Utility-payment-on-time rate → [0,1000].
 * 100% on-time = 1000. 0% = 0. No history (paymentsObserved=0) = 500
 * (neutral; cannot punish a customer with no signal).
 */
export function scoreUtilityOnTime(signal: UtilityPaymentSignal): number {
  if (signal.paymentsObserved === 0) return 500;
  const onTimeRate = Math.min(1, signal.paymentsOnTime / signal.paymentsObserved);
  return Math.round(onTimeRate * 1000);
}

/**
 * Payroll regularity → [0,1000].
 * 100% on-schedule = 1000. 0% = 0. No payroll signal = 400 (slightly
 * below neutral — irregular/cash income is a moderate risk signal in
 * the rental context).
 */
export function scorePayrollRegularity(signal: PayrollSignal): number {
  if (signal.periodsObserved === 0) return 400;
  const rate = Math.min(1, signal.periodsOnSchedule / signal.periodsObserved);
  return Math.round(rate * 1000);
}

// ─────────────────────────────────────────────────────────────────────
// Band classifier — same thresholds as rent-history rating
// ─────────────────────────────────────────────────────────────────────

export function bandFor(score: number): CreditBand {
  if (score >= 800) return 'excellent';
  if (score >= 650) return 'good';
  if (score >= 450) return 'fair';
  return 'poor';
}

// ─────────────────────────────────────────────────────────────────────
// Repository port — persistence is owned by the caller
// ─────────────────────────────────────────────────────────────────────

export interface AltCreditScoreRepository {
  saveScore(score: AltCreditScore & {
    readonly rawInputs: AltCreditInput;
  }): Promise<void>;
  loadLatestScore(
    tenantId: string,
    customerId: string,
  ): Promise<AltCreditScore | null>;
}

// ─────────────────────────────────────────────────────────────────────
// Service factory
// ─────────────────────────────────────────────────────────────────────

export interface AltCreditServiceDeps {
  readonly repo: AltCreditScoreRepository;
  readonly weights?: AltCreditWeights;
  readonly clock?: () => Date;
  /**
   * Optional M-Pesa adapter — when supplied, the service can refresh
   * the M-Pesa signal from the adapter on a recompute. NOT used by the
   * pure scoring path (which takes a pre-resolved input).
   */
  readonly mpesa?: MpesaAdapterPort;
}

export interface AltCreditService {
  /**
   * Compute and persist a score from a pre-resolved input. No external
   * calls — pure deterministic transform.
   */
  score(input: AltCreditInput): Promise<AltCreditScore>;
  /** Get the most recent saved score for (tenant, customer). */
  latest(tenantId: string, customerId: string): Promise<AltCreditScore | null>;
}

export function createAltCreditService(
  deps: AltCreditServiceDeps,
): AltCreditService {
  const weights = deps.weights ?? DEFAULT_ALT_CREDIT_WEIGHTS;
  const totalWeight =
    weights.mpesaCashflow + weights.utilityOnTime + weights.payrollRegularity;
  if (totalWeight <= 0) {
    throw new Error('createAltCreditService: weights must sum to > 0');
  }
  const clock = deps.clock ?? (() => new Date());

  async function score(input: AltCreditInput): Promise<AltCreditScore> {
    const parsed = AltCreditInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(
        `alt-credit: invalid input — ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
    }
    if (input.utility.paymentsOnTime > input.utility.paymentsObserved) {
      throw new Error(
        'alt-credit: utility.paymentsOnTime cannot exceed paymentsObserved',
      );
    }
    if (input.payroll.periodsOnSchedule > input.payroll.periodsObserved) {
      throw new Error(
        'alt-credit: payroll.periodsOnSchedule cannot exceed periodsObserved',
      );
    }

    const mpesaSub = scoreMpesaCashflow(input.mpesa);
    const utilitySub = scoreUtilityOnTime(input.utility);
    const payrollSub = scorePayrollRegularity(input.payroll);

    const blended =
      (mpesaSub * weights.mpesaCashflow +
        utilitySub * weights.utilityOnTime +
        payrollSub * weights.payrollRegularity) /
      totalWeight;

    const finalScore = Math.max(0, Math.min(1000, Math.round(blended)));
    const result: AltCreditScore = {
      tenantId: input.tenantId,
      customerId: input.customerId,
      score: finalScore,
      band: bandFor(finalScore),
      subScores: {
        mpesaCashflow: mpesaSub,
        utilityOnTime: utilitySub,
        payrollRegularity: payrollSub,
      },
      modelVersion: ALT_CREDIT_MODEL_VERSION,
      computedAt: clock().toISOString(),
    };
    await deps.repo.saveScore({ ...result, rawInputs: input });
    return result;
  }

  async function latest(
    tenantId: string,
    customerId: string,
  ): Promise<AltCreditScore | null> {
    return deps.repo.loadLatestScore(tenantId, customerId);
  }

  return { score, latest };
}

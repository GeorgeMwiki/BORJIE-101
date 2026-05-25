/**
 * Confidence scorer — Wave 28.
 *
 * Per-action confidence in the range 0..1. Deterministic baseline +
 * optional LLM-adjusted lift.
 *
 * Baseline rules (all additive, then clamped to [0,1]):
 *
 *   - Start at 0.5.
 *   - +0.05 per trusted boolean feature present.
 *   - +0.10 when historical success-rate for (domain, actionType) >= 0.8.
 *   - -0.10 when historical success-rate for (domain, actionType) <= 0.5.
 *   - -0.15 for legal/safety-critical contexts.
 *   - -0.05 per distinct "risk" feature in context.
 *
 * LOW_CONFIDENCE_THRESHOLD (0.6) is exported so callers can gate on it
 * without hard-coding the value. The autonomy guard treats anything
 * below this threshold as "requires human approval regardless of
 * policy".
 */

import {
  LOW_CONFIDENCE_THRESHOLD,
  type ConfidenceContext,
  type ConfidenceScore,
  type OutcomeRepository,
} from './types.js';
import { safeJsonParse, type ClassifyLLMPort } from '../ai-native/shared.js';

export { LOW_CONFIDENCE_THRESHOLD } from './types.js';

export interface ConfidenceScorerDeps {
  readonly outcomes?: OutcomeRepository;
  readonly llm?: ClassifyLLMPort;
  readonly now?: () => Date;
  /**
   * Look-back window in ms for history-based adjustment. Defaults to 30
   * days — enough to capture a meaningful pattern without being swamped
   * by stale data.
   */
  readonly lookbackMs?: number;
}

const DEFAULT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

const TRUSTED_BOOLEAN_FEATURES: readonly string[] = [
  'vendorIsTrusted',
  'tenantInGoodStanding',
  'approvedByPrimary',
  'withinQuietHours',
];

const RISK_FEATURES: readonly string[] = [
  'isLegalNotice',
  'isSafetyCritical',
  'disputeInFlight',
  'firstTimeAction',
];

/**
 * Numerical-contradiction penalty.
 *
 * When the trace records ≥1 instance of two tools returning
 * disagreeing numerics for the same quantity (e.g. two M-Pesa
 * receipts disagree on amount; ledger row vs bank-statement row;
 * two property valuations differ by >5%), the action's confidence is
 * pulled down. Linear in the count, capped so a single noisy session
 * cannot collapse confidence to 0 on its own.
 *
 * Closes May 18 parity gap §5 row 1 ("per-tool numerical
 * contradictions feeding the confidence scorer").
 */
const NUMERICAL_CONTRADICTION_PER_INSTANCE = 0.08;
const NUMERICAL_CONTRADICTION_MAX_PENALTY = 0.24; // 3+ contradictions = max

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function countTrustedFeatures(features: Readonly<Record<string, unknown>>): number {
  let c = 0;
  for (const key of TRUSTED_BOOLEAN_FEATURES) {
    if (features[key] === true) c += 1;
  }
  return c;
}

function countRiskFeatures(features: Readonly<Record<string, unknown>>): number {
  let c = 0;
  for (const key of RISK_FEATURES) {
    if (features[key] === true) c += 1;
  }
  return c;
}

function numericalContradictionPenalty(
  features: Readonly<Record<string, unknown>>,
): { penalty: number; count: number } {
  const raw = features['numericalContradictionCount'];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return { penalty: 0, count: 0 };
  }
  const count = Math.floor(raw);
  const penalty = Math.min(
    NUMERICAL_CONTRADICTION_MAX_PENALTY,
    count * NUMERICAL_CONTRADICTION_PER_INSTANCE,
  );
  return { penalty, count };
}

async function historicalSuccessRate(
  deps: ConfidenceScorerDeps,
  context: ConfidenceContext,
): Promise<number | null> {
  if (!deps.outcomes) return null;
  const now = deps.now ?? (() => new Date());
  const lookback = deps.lookbackMs ?? DEFAULT_LOOKBACK_MS;
  const since = new Date(now().getTime() - lookback).toISOString();
  const events = await deps.outcomes.findByTenant(context.tenantId, {
    domain: context.domain,
    actionType: context.actionType,
    since,
    limit: 500,
  });
  const resolved = events.filter(
    (e) => e.outcome === 'success' || e.outcome === 'failure' || e.outcome === 'reverted',
  );
  if (resolved.length === 0) return null;
  const successes = resolved.filter((e) => e.outcome === 'success').length;
  return successes / resolved.length;
}

export interface ConfidenceScorer {
  scoreAction(context: ConfidenceContext): Promise<ConfidenceScore>;
  /** Synchronous, LLM-free scoring — used by the guard on the hot path. */
  scoreActionSync(
    context: ConfidenceContext,
    historical?: number | null,
  ): ConfidenceScore;
}

function computeBaseline(
  context: ConfidenceContext,
  historical: number | null,
): { value: number; reasoning: string[] } {
  let score = 0.5;
  const notes: string[] = ['baseline=0.5'];

  const trusted = countTrustedFeatures(context.features);
  if (trusted > 0) {
    score += trusted * 0.05;
    notes.push(`+${(trusted * 0.05).toFixed(2)} trusted-features(${trusted})`);
  }

  const risk = countRiskFeatures(context.features);
  if (risk > 0) {
    score -= risk * 0.05;
    notes.push(`-${(risk * 0.05).toFixed(2)} risk-features(${risk})`);
  }

  if (
    context.features.isLegalNotice === true ||
    context.features.isSafetyCritical === true
  ) {
    score -= 0.15;
    notes.push('-0.15 legal/safety-critical');
  }

  const numContra = numericalContradictionPenalty(context.features);
  if (numContra.penalty > 0) {
    score -= numContra.penalty;
    notes.push(`-${numContra.penalty.toFixed(2)} numerical-contradictions(${numContra.count})`);
  }

  if (historical !== null) {
    if (historical >= 0.8) {
      score += 0.1;
      notes.push(`+0.10 historical-success=${historical.toFixed(2)}`);
    } else if (historical <= 0.5) {
      score -= 0.1;
      notes.push(`-0.10 historical-success=${historical.toFixed(2)}`);
    }
  }

  return { value: clamp01(score), reasoning: notes };
}

const LLM_PROMPT = `You score AI-action confidence 0..1. Return ONLY JSON:
{
  "adjustment": number (-0.2..0.2),
  "reason": string (<200 chars)
}
Guidance:
- Lean negative when the action is irreversible.
- Lean positive when rationale is supported by concrete context features.
- Never exceed +/-0.2.`;

export function createConfidenceScorer(
  deps: ConfidenceScorerDeps = {},
): ConfidenceScorer {
  function scoreActionSync(
    context: ConfidenceContext,
    historical: number | null = null,
  ): ConfidenceScore {
    const { value: baseline, reasoning } = computeBaseline(context, historical);
    return {
      value: baseline,
      baseline,
      llmAdjustment: 0,
      reasoning: reasoning.join('; '),
    };
  }

  async function scoreAction(context: ConfidenceContext): Promise<ConfidenceScore> {
    const historical = await historicalSuccessRate(deps, context);
    const sync = scoreActionSync(context, historical);
    if (!deps.llm) return sync;

    try {
      const res = await deps.llm.classify({
        systemPrompt: LLM_PROMPT,
        userPrompt: JSON.stringify({
          domain: context.domain,
          actionType: context.actionType,
          features: context.features,
          historicalSuccessRate: historical,
        }),
      });
      const parsed = safeJsonParse<{ adjustment?: number; reason?: string }>(res.raw);
      let adjustment = 0;
      let llmReason = '';
      if (parsed && typeof parsed.adjustment === 'number') {
        adjustment = Math.max(-0.2, Math.min(0.2, parsed.adjustment));
        llmReason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 200) : '';
      }
      const nextValue = clamp01(sync.baseline + adjustment);
      return {
        value: nextValue,
        baseline: sync.baseline,
        llmAdjustment: adjustment,
        reasoning:
          llmReason === ''
            ? sync.reasoning
            : `${sync.reasoning}; llm=${adjustment.toFixed(2)}:${llmReason}`,
      };
    } catch {
      return sync;
    }
  }

  return { scoreAction, scoreActionSync };
}

export function requiresHumanReview(score: ConfidenceScore): boolean {
  return score.value < LOW_CONFIDENCE_THRESHOLD;
}

/**
 * outcome-scorer — multi-objective weighted scoring.
 *
 * Each outcome maps to a vector of per-objective scores in [0, 1];
 * the final score is the dot product with the OwnerIntent weights.
 */

import type {
  ScenarioOutcome,
  ScoredOutcome,
  OwnerIntent,
} from '../types.js';

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function cashflowSubScore(outcome: ScenarioOutcome): number {
  if (outcome.projectedNoi.length === 0) return 0.5;
  const totalP50 = outcome.projectedNoi.reduce((s, b) => s + b.p50, 0);
  // Normalize via a soft sigmoid centered on zero. We don't know the
  // scale a-priori, so we use tanh on (totalP50 / horizon) — produces
  // 0 = neutral, 1 = strongly positive.
  const monthlyAvg = totalP50 / outcome.projectedNoi.length;
  const norm = Math.tanh(monthlyAvg / 50_000);
  return clamp01(0.5 + norm * 0.5);
}

function shortfallPenalty(outcome: ScenarioOutcome): number {
  return 1 - clamp01(outcome.cashShortfallProbability);
}

export function scoreOutcome(
  outcome: ScenarioOutcome,
  intent: OwnerIntent,
): ScoredOutcome {
  const cashflow = cashflowSubScore(outcome) * shortfallPenalty(outcome);
  const retention = clamp01(outcome.retentionProbability);
  const compliance = clamp01(outcome.complianceScore);
  const intentAlignment = clamp01(outcome.intentAlignment);

  const score =
    cashflow * intent.weights.cashflow +
    retention * intent.weights.retention +
    compliance * intent.weights.compliance +
    intentAlignment * intent.weights.intentAlignment;

  return {
    ...outcome,
    score,
    perObjective: { cashflow, retention, compliance, intentAlignment },
  };
}

export function rankByObjective(
  scored: ReadonlyArray<ScoredOutcome>,
): ReadonlyArray<ScoredOutcome> {
  return [...scored].sort((a, b) => b.score - a.score);
}

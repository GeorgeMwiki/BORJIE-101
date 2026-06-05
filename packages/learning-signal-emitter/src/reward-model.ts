/**
 * Reward model — PURE function over (action, outcome).
 *
 * Combines six bounded components into a single reward in [-1, 1]:
 *   - SLA hit/miss + how early or late
 *   - Manager override (manual flip is a strong negative)
 *   - Owner complaint
 *   - Regulator finding
 *   - Cost (under-budget bonus, over-budget penalty)
 *   - Explicit satisfaction signal (thumbs, NPS)
 *
 * Default Borjie weight mix:
 *   sla=0.30, override=0.20, complaint=0.20, regulator=0.15, cost=0.05, sat=0.10
 *
 * Ported from LITFIN learning/reward-model.ts. Currency-agnostic: the cost
 * dimension uses a ratio (cost / budget), so no currency is hard-coded.
 */

import type {
  ActionEvent,
  OutcomeEvent,
  RewardComponents,
  RewardWeights,
  ScoredAction,
} from './types.js';

export const DEFAULT_WEIGHTS: RewardWeights = Object.freeze({
  sla: 0.3,
  override: 0.2,
  complaint: 0.2,
  regulator: 0.15,
  cost: 0.05,
  satisfaction: 0.1,
});

const ZERO_COMPONENTS: RewardComponents = Object.freeze({
  sla: 0,
  override: 0,
  complaint: 0,
  regulator: 0,
  cost: 0,
  satisfaction: 0,
});

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < lo) return lo;
  if (value > hi) return hi;
  // `+ 0` flushes negative zero (e.g. -0/300) to +0 so downstream equality
  // checks + JSON serialisation stay canonical.
  return value + 0;
}

/**
 * SLA dimension. Bonus when hit early (negative delay), neutral on-time,
 * penalty when missed. Earliness saturates at -300s, lateness at +900s.
 */
function scoreSla(outcome: OutcomeEvent): number {
  if (outcome.slaHit === undefined && outcome.slaDelaySeconds === undefined) {
    return 0;
  }
  // A hard miss with no measured delay is the worst SLA signal — saturate at
  // -1 rather than defaulting to a mid-range delay (the old `?? 600` capped
  // the penalty at ~-0.67 and never reached the floor).
  if (outcome.slaHit === false && outcome.slaDelaySeconds === undefined) {
    return -1;
  }
  const delay = outcome.slaDelaySeconds ?? 0;
  if (delay <= -300) return 1;
  if (delay >= 900) return -1;
  if (delay <= 0) return clamp(-delay / 300, 0, 1);
  return clamp(-delay / 900, -1, 0);
}

function scoreOverride(outcome: OutcomeEvent): number {
  return outcome.managerOverride ? -1 : 0;
}

function scoreComplaint(outcome: OutcomeEvent): number {
  return outcome.ownerComplaint ? -1 : 0;
}

function scoreRegulator(outcome: OutcomeEvent): number {
  return outcome.regulatorFinding ? -1 : 0;
}

/**
 * Cost score. +0.5 when under budget by >= 50%, 0 on budget, -1 when over
 * budget by >= 100%. Defaults to 0 when either value is missing.
 */
function scoreCost(outcome: OutcomeEvent): number {
  if (outcome.costTzs === undefined || outcome.budgetTzs === undefined) {
    return 0;
  }
  if (outcome.budgetTzs <= 0) return 0;
  const ratio = outcome.costTzs / outcome.budgetTzs;
  if (ratio <= 0.5) return 0.5;
  if (ratio >= 2) return -1;
  if (ratio <= 1) return clamp(1 - ratio, 0, 0.5);
  return clamp(-(ratio - 1), -1, 0);
}

function scoreSatisfaction(outcome: OutcomeEvent): number {
  if (outcome.explicitSatisfaction === undefined) return 0;
  return clamp(outcome.explicitSatisfaction, -1, 1);
}

export interface ScoreActionInput {
  readonly action: ActionEvent;
  readonly outcome: OutcomeEvent;
  readonly weights?: RewardWeights;
}

/**
 * Score one (action, outcome) pair against the reward weights. PURE.
 * Returns the per-component breakdown so the dashboard can render the
 * gradient + the auditor can reconstruct the verdict.
 */
export function scoreAction(input: ScoreActionInput): ScoredAction {
  if (!input.action || !input.outcome) {
    return {
      reward: 0,
      components: ZERO_COMPONENTS,
      weights: input.weights ?? DEFAULT_WEIGHTS,
    };
  }
  const weights = input.weights ?? DEFAULT_WEIGHTS;
  const components: RewardComponents = Object.freeze({
    sla: scoreSla(input.outcome),
    override: scoreOverride(input.outcome),
    complaint: scoreComplaint(input.outcome),
    regulator: scoreRegulator(input.outcome),
    cost: scoreCost(input.outcome),
    satisfaction: scoreSatisfaction(input.outcome),
  });
  const reward = clamp(
    components.sla * weights.sla +
      components.override * weights.override +
      components.complaint * weights.complaint +
      components.regulator * weights.regulator +
      components.cost * weights.cost +
      components.satisfaction * weights.satisfaction,
    -1,
    1,
  );
  return Object.freeze({ reward, components, weights });
}

/** Convenience: scalar reward only. */
export function rewardOf(input: ScoreActionInput): number {
  return scoreAction(input).reward;
}

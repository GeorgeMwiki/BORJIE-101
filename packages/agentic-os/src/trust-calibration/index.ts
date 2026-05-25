/**
 * trust-calibration — each (agent, capability) pair carries a Bayesian
 * trust score that grows with successful outcomes and decays with
 * inactivity. The score informs autonomy ceilings (via OpenClaw) and
 * the brain-first gateway's ranking.
 *
 * Decay model: if no outcome observed for `decayHalfLifeDays` days,
 * the score moves halfway toward the prior. This forces re-proving.
 *
 * References:
 *   - Sutton & Barto, "Reinforcement Learning" 2nd ed — Bayesian updates
 *   - Klarna autonomy-decay incident (2025) — why decay must be modelled
 *   - SAE J3016 — risk-bounded autonomy ladders (mirrors openclaw)
 */

import type {
  AutonomyLevel,
  RiskClass,
  TrustOutcome,
  TrustScore,
  TrustStorePort,
} from '../types.js';
import { nowIso } from '../types.js';

// ============================================================================
// In-memory implementation
// ============================================================================

export interface TrustCalibratorConfig {
  /** Beta-prior alpha (successes). Default 1. */
  readonly priorAlpha?: number;
  /** Beta-prior beta (failures). Default 1. */
  readonly priorBeta?: number;
  /** Recent-window length in samples. Default 30. */
  readonly recentWindow?: number;
  /** Decay half-life in days. Default 14. */
  readonly decayHalfLifeDays?: number;
}

const DEFAULTS: Required<TrustCalibratorConfig> = {
  priorAlpha: 1,
  priorBeta: 1,
  recentWindow: 30,
  decayHalfLifeDays: 14,
};

interface InternalState {
  alpha: number;
  beta: number;
  recentOutcomes: TrustOutcome[];
  lastUpdatedAt: string;
}

export function createTrustCalibrator(
  config: TrustCalibratorConfig = {},
): TrustStorePort & {
  /** Suggest autonomy ceiling given the current score + risk class. */
  suggestedAutonomyLevel(args: {
    readonly agentId: string;
    readonly capabilityId: string;
    readonly riskClass: RiskClass;
  }): Promise<AutonomyLevel>;
} {
  const cfg = { ...DEFAULTS, ...config };
  const states = new Map<string, InternalState>();

  function k(agentId: string, capabilityId: string): string {
    return `${agentId}::${capabilityId}`;
  }

  function recordedNow(): InternalState {
    return {
      alpha: cfg.priorAlpha,
      beta: cfg.priorBeta,
      recentOutcomes: [],
      lastUpdatedAt: nowIso(),
    };
  }

  function applyDecay(state: InternalState): InternalState {
    const days = daysBetween(state.lastUpdatedAt, nowIso());
    if (days <= 0) return state;
    const halfLives = days / cfg.decayHalfLifeDays;
    const factor = Math.pow(0.5, halfLives);
    const decayedSuccesses = (state.alpha - cfg.priorAlpha) * factor;
    const decayedFailures = (state.beta - cfg.priorBeta) * factor;
    return {
      ...state,
      alpha: cfg.priorAlpha + decayedSuccesses,
      beta: cfg.priorBeta + decayedFailures,
    };
  }

  function applyOutcome(
    state: InternalState,
    outcome: TrustOutcome,
  ): InternalState {
    const weight = Math.max(0, Math.min(1, outcome.confidence));
    let alpha = state.alpha;
    let beta = state.beta;
    if (outcome.outcome === 'success') alpha += weight;
    else if (outcome.outcome === 'partial') {
      alpha += weight * 0.5;
      beta += weight * 0.5;
    } else if (outcome.outcome === 'failure') beta += weight;
    else if (outcome.outcome === 'escalated') beta += weight * 0.25;
    const recent = state.recentOutcomes.slice(-(cfg.recentWindow - 1));
    recent.push(outcome);
    return {
      alpha,
      beta,
      recentOutcomes: recent,
      lastUpdatedAt: outcome.observedAt,
    };
  }

  function computeRecentSuccessRate(outcomes: TrustOutcome[]): number {
    if (outcomes.length === 0) return 0.5;
    const window = outcomes.slice(-cfg.recentWindow);
    const successes = window.reduce((acc, o) => {
      if (o.outcome === 'success') return acc + 1;
      if (o.outcome === 'partial') return acc + 0.5;
      return acc;
    }, 0);
    return successes / window.length;
  }

  function meanFromBeta(state: InternalState): number {
    return state.alpha / (state.alpha + state.beta);
  }

  function snapshot(
    agentId: string,
    capabilityId: string,
    state: InternalState,
  ): TrustScore {
    const meanSuccessRate = meanFromBeta(state);
    const recentSuccessRate = computeRecentSuccessRate(state.recentOutcomes);
    const recommendedCeiling = ceilingFromScore(meanSuccessRate);
    return Object.freeze({
      agentId,
      capabilityId,
      meanSuccessRate,
      sampleSize: state.recentOutcomes.length,
      recentSuccessRate,
      lastUpdatedAt: state.lastUpdatedAt,
      recommendedCeiling,
    });
  }

  return {
    async recordOutcome(outcome) {
      const key = k(outcome.agentId, outcome.capabilityId);
      const existing = states.get(key) ?? recordedNow();
      const decayed = applyDecay(existing);
      const next = applyOutcome(decayed, outcome);
      states.set(key, next);
    },
    async getScore({ agentId, capabilityId }) {
      const existing = states.get(k(agentId, capabilityId));
      if (!existing) return null;
      const decayed = applyDecay(existing);
      return snapshot(agentId, capabilityId, decayed);
    },
    async list() {
      const out: TrustScore[] = [];
      for (const [key, state] of states) {
        const [agentId, capabilityId] = key.split('::');
        if (!agentId || !capabilityId) continue;
        const decayed = applyDecay(state);
        out.push(snapshot(agentId, capabilityId, decayed));
      }
      return out;
    },
    async suggestedAutonomyLevel({ agentId, capabilityId, riskClass }) {
      const score = await this.getScore({ agentId, capabilityId });
      const mean = score?.meanSuccessRate ?? 0.5;
      const base = ceilingFromScore(mean);
      const riskCap = riskCeilingFor(riskClass);
      return base <= riskCap ? base : riskCap;
    },
  };
}

function ceilingFromScore(score: number): AutonomyLevel {
  if (score >= 0.95) return 'L5';
  if (score >= 0.85) return 'L4';
  if (score >= 0.70) return 'L3';
  if (score >= 0.55) return 'L2';
  if (score >= 0.40) return 'L1';
  return 'L0';
}

function riskCeilingFor(riskClass: RiskClass): AutonomyLevel {
  const map: Record<RiskClass, AutonomyLevel> = {
    low: 'L5',
    med: 'L4',
    high: 'L3',
    critical: 'L2',
  };
  return map[riskClass];
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return 0;
  return (b - a) / 86_400_000;
}

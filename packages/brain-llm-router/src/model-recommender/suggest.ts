/**
 * model-recommender/suggest.ts — the AI-SUGGEST recommender (F3).
 *
 * A PURE, SUGGEST-ONLY service: given a set of use-cases and a model catalog,
 * it scores each candidate per use-case from three metadata axes and returns
 * a ranked suggestion with a human-readable rationale + estimated cost/latency.
 *
 *   - COST       : from MODEL_PRICING (per-million input+output blend). Lower
 *                  is better.
 *   - CAPABILITY : from the min-tier FAMILY_RANK + the use-case's minimum
 *                  family floor (MODEL_REQUIREMENTS). A candidate BELOW the
 *                  floor is disqualified (capability hard-gate); above the
 *                  floor, higher rank scores higher only up to what the
 *                  use-case needs (no over-provisioning premium).
 *   - LATENCY    : from injected real p50 latency metadata (ai_cost_entries
 *                  rollup at the gateway); lower is better. Optional — absent
 *                  latency falls back to a family-derived heuristic.
 *
 * HITL: this NEVER writes config. It returns suggestions the admin reviews and
 * applies via the routing-config write path. The recommender cannot route a
 * locked/sovereign use-case off its floor — disqualification is by
 * construction (a below-floor candidate is removed before ranking).
 *
 * No I/O, no mutation. All inputs are injected; outputs are frozen.
 */

import { getPricing } from '../cost-cascade/pricing.js';
import { MODEL_REQUIREMENTS } from '../dynamic-registry/min-tier-policy.js';
import type { ModelFamily } from '../dynamic-registry/baselines.js';

/** A candidate model the admin could assign to a use-case. */
export interface ModelCandidate {
  readonly model: string; // canonical model id (e.g. anthropic/claude-haiku-4-5)
  readonly family: ModelFamily;
}

/** Optional real-spend / latency metadata keyed by model id. */
export interface ModelMetrics {
  /** Observed p50 latency in ms (from ai_cost_entries rollup). */
  readonly p50LatencyMs?: number;
}

export interface SuggestArgs {
  /** Use-case keys to produce a suggestion for (intents / surfaces). */
  readonly useCases: readonly string[];
  /** The model catalog the admin may choose from. */
  readonly catalog: readonly ModelCandidate[];
  /** Optional per-model real metrics (latency). */
  readonly metrics?: Readonly<Record<string, ModelMetrics>>;
  /**
   * Axis weights (0..1). Defaults bias capability > cost > latency so legal/
   * financial use-cases are never under-served. Normalised internally.
   */
  readonly weights?: {
    readonly cost?: number;
    readonly capability?: number;
    readonly latency?: number;
  };
}

export interface ModelSuggestion {
  readonly model: string;
  readonly family: ModelFamily;
  /** Composite score [0..1]; higher = better fit. */
  readonly score: number;
  /** Estimated blended cost (USD per 1M tokens, input+output averaged). */
  readonly estimatedCostPerMillion: number;
  /** Estimated p50 latency in ms (observed or heuristic). */
  readonly estimatedLatencyMs: number;
  /** Human-readable why-this-model rationale. */
  readonly rationale: string;
}

export interface UseCaseSuggestion {
  readonly useCase: string;
  /** The minimum family floor this use-case requires (if policy-pinned). */
  readonly minFamily: ModelFamily | null;
  /** Ranked candidates, best first. Empty when none meet the floor. */
  readonly ranked: readonly ModelSuggestion[];
  /** Convenience: the top suggestion, or null when none qualifies. */
  readonly top: ModelSuggestion | null;
}

export interface SuggestResult {
  readonly perUseCase: readonly UseCaseSuggestion[];
}

// Family capability rank — mirrors min-tier-policy FAMILY_RANK so the
// recommender and the enforcement floor agree.
const FAMILY_RANK: Readonly<Partial<Record<ModelFamily, number>>> = Object.freeze({
  haiku: 1,
  'gpt-5-mini': 1,
  'gemini-flash': 1,
  'deepseek-chat': 1,
  sonnet: 3,
  'gpt-5': 3,
  'gemini-pro': 3,
  'deepseek-coder': 3,
  opus: 5,
});

// Heuristic p50 latency by capability rank when no observed metric exists.
// Higher-capability models are slower; used only as a fallback floor.
const HEURISTIC_LATENCY_BY_RANK: Readonly<Record<number, number>> = Object.freeze({
  0: 600,
  1: 700,
  3: 1500,
  5: 3200,
});

function rankOf(family: ModelFamily): number {
  return FAMILY_RANK[family] ?? 0;
}

function blendedCostPerMillion(model: string): number {
  const p = getPricing(model);
  return (p.inputPerMillion + p.outputPerMillion) / 2;
}

function heuristicLatency(family: ModelFamily): number {
  return HEURISTIC_LATENCY_BY_RANK[rankOf(family)] ?? 1000;
}

function minFamilyFor(useCase: string): ModelFamily | null {
  const req = MODEL_REQUIREMENTS[useCase as keyof typeof MODEL_REQUIREMENTS];
  return req ? req.minFamily : null;
}

/** Normalise a value against a [min,max] range into [0,1], lower-is-better. */
function lowerIsBetter(value: number, min: number, max: number): number {
  if (max <= min) return 1;
  const clamped = Math.max(min, Math.min(max, value));
  return 1 - (clamped - min) / (max - min);
}

/**
 * Produce ranked routing suggestions per use-case. Pure + suggest-only.
 */
export function suggestModelRouting(args: SuggestArgs): SuggestResult {
  const weights = normaliseWeights(args.weights);
  const catalog = args.catalog;

  // Pre-compute cost + latency ranges across the catalog for normalisation.
  const costs = catalog.map((c) => blendedCostPerMillion(c.model));
  const latencies = catalog.map(
    (c) =>
      args.metrics?.[c.model]?.p50LatencyMs ?? heuristicLatency(c.family),
  );
  const costMin = Math.min(...costs, 0);
  const costMax = Math.max(...costs, 1);
  const latMin = Math.min(...latencies, 0);
  const latMax = Math.max(...latencies, 1);

  const perUseCase: UseCaseSuggestion[] = args.useCases.map((useCase) => {
    const floor = minFamilyFor(useCase);
    const floorRank = floor ? rankOf(floor) : 0;

    const ranked: ModelSuggestion[] = catalog
      // CAPABILITY HARD-GATE: drop candidates below the use-case floor.
      .filter((c) => rankOf(c.family) >= floorRank)
      .map((c) => {
        const cost = blendedCostPerMillion(c.model);
        const latency =
          args.metrics?.[c.model]?.p50LatencyMs ?? heuristicLatency(c.family);

        const costScore = lowerIsBetter(cost, costMin, costMax);
        const latencyScore = lowerIsBetter(latency, latMin, latMax);
        // Capability score: meeting the floor is the win; over-provisioning
        // earns a small premium only (so we don't always pick opus).
        const overFloor = Math.max(0, rankOf(c.family) - floorRank);
        const capabilityScore = Math.min(1, 0.8 + overFloor * 0.05);

        const score =
          weights.cost * costScore +
          weights.capability * capabilityScore +
          weights.latency * latencyScore;

        return {
          model: c.model,
          family: c.family,
          score: Number(score.toFixed(4)),
          estimatedCostPerMillion: Number(cost.toFixed(4)),
          estimatedLatencyMs: Math.round(latency),
          rationale: buildRationale({
            family: c.family,
            floor,
            cost,
            latency,
            costScore,
            latencyScore,
          }),
        };
      })
      .sort((a, b) => b.score - a.score);

    return {
      useCase,
      minFamily: floor,
      ranked: Object.freeze(ranked),
      top: ranked[0] ?? null,
    };
  });

  return { perUseCase: Object.freeze(perUseCase) };
}

function normaliseWeights(
  w: SuggestArgs['weights'],
): { cost: number; capability: number; latency: number } {
  const cost = w?.cost ?? 0.35;
  const capability = w?.capability ?? 0.45;
  const latency = w?.latency ?? 0.2;
  const sum = cost + capability + latency;
  if (sum <= 0) return { cost: 0.35, capability: 0.45, latency: 0.2 };
  return { cost: cost / sum, capability: capability / sum, latency: latency / sum };
}

function buildRationale(args: {
  readonly family: ModelFamily;
  readonly floor: ModelFamily | null;
  readonly cost: number;
  readonly latency: number;
  readonly costScore: number;
  readonly latencyScore: number;
}): string {
  const parts: string[] = [];
  if (args.floor) {
    parts.push(`Meets the ${args.floor}-class floor for this use-case`);
  } else {
    parts.push('No policy floor; any model qualifies');
  }
  if (args.costScore >= 0.66) parts.push('low cost');
  else if (args.costScore <= 0.33) parts.push('higher cost');
  if (args.latencyScore >= 0.66) parts.push('fast p50 latency');
  else if (args.latencyScore <= 0.33) parts.push('slower p50 latency');
  parts.push(
    `(~$${args.cost.toFixed(2)}/1M tokens, ~${Math.round(args.latency)}ms p50)`,
  );
  return parts.join('; ');
}

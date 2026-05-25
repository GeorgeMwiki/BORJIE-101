/**
 * cost-cascade/ — Haiku -> Sonnet -> Opus escalation.
 *
 * Pattern (research §2.3, RouteLLM): try the cheapest model first; if a
 * caller-supplied `evalFn(response) < confidenceThreshold`, escalate to the
 * next model. Stops on first confident response OR when budget exhausted.
 *
 * Realised savings (research §6 + RouteLLM ICLR 2025): 70%+ inference
 * spend reduction at ~95% quality on bulk tenant chat.
 *
 * The eval function is duck-typed — callers plug in M-B Self-Consistency
 * agreement, a CoVe verifier, or a trained ModernBERT classifier.
 */

import type { BrainLLMClient, BrainLLMRequest, BrainLLMResponse, ModelTier, ProviderName } from '../types.js';
import { BrainLLMError } from '../types.js';
import { computeCost, getPricing } from './pricing.js';

export interface CascadeStep {
  readonly model: ModelTier;
  readonly client: BrainLLMClient;
}

/**
 * Eval function returns a quality score in [0..1]. Threshold gates escalation.
 * The function is async so callers can run extra inference (CoVe verifier).
 */
export type EvalFn = (resp: BrainLLMResponse) => Promise<number> | number;

export interface CascadeConfig {
  readonly confidenceThreshold?: number; // default 0.6
  readonly budgetUsd?: number; // hard cap across cascade
  readonly evalFn: EvalFn;
  /** Hook for telemetry on each escalation step. */
  readonly onStep?: (event: {
    readonly model: ModelTier;
    readonly provider: ProviderName;
    readonly score: number;
    readonly costUsd: number;
    readonly cumulativeCostUsd: number;
    readonly escalated: boolean;
  }) => void;
}

export interface CascadeResult {
  readonly response: BrainLLMResponse;
  readonly modelUsed: ModelTier;
  readonly steps: number; // 1 = cheapest worked, 3 = full escalation
  readonly totalCostUsd: number;
  readonly savingsVsTopUsd: number; // hypothetical cost-if-we-went-Opus-only
}

/**
 * Run a cascade. The `steps` array is ordered cheapest -> most expensive.
 *
 * Each step's response is graded by `evalFn`. If score >= threshold, we
 * return immediately. Otherwise we escalate. If budget is exhausted before
 * a confident response, return the best score so far (still useful;
 * caller can decide whether to surface a low-confidence warning).
 */
export async function runCascade(
  req: BrainLLMRequest,
  steps: readonly CascadeStep[],
  config: CascadeConfig
): Promise<CascadeResult> {
  if (steps.length === 0) {
    throw new BrainLLMError({
      code: 'EMPTY_CASCADE',
      message: 'cost-cascade steps cannot be empty',
      retryable: false,
    });
  }

  const threshold = config.confidenceThreshold ?? 0.6;
  let cumulativeCost = 0;
  let best: { response: BrainLLMResponse; model: ModelTier; score: number; cost: number } | undefined;

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;
    const pricing = getPricing(step.model);

    // Pre-flight cost projection. If projected cost + cumulative > budget, skip.
    // Use a heuristic: assume worst-case maxTokens for output.
    const projectedOutputTokens = req.maxTokens ?? 4096;
    const projectedInputTokens = estimateInputTokens(req);
    const { usd: projected } = computeCost(
      { inputTokens: projectedInputTokens, outputTokens: projectedOutputTokens },
      pricing
    );
    if (config.budgetUsd !== undefined && cumulativeCost + projected > config.budgetUsd) {
      break;
    }

    const response = await step.client.invoke({ ...req, model: step.model });
    const { usd: stepCost } = computeCost(response.usage, pricing);
    cumulativeCost += stepCost;

    const score = await config.evalFn(response);
    const escalated = score < threshold && i < steps.length - 1;
    if (config.onStep) {
      config.onStep({
        model: step.model,
        provider: response.provider,
        score,
        costUsd: stepCost,
        cumulativeCostUsd: cumulativeCost,
        escalated,
      });
    }

    if (best === undefined || score > best.score) {
      best = { response, model: step.model, score, cost: stepCost };
    }

    if (score >= threshold) {
      const topCost = costAtTopOfLadder(req, steps);
      return {
        response,
        modelUsed: step.model,
        steps: i + 1,
        totalCostUsd: cumulativeCost,
        savingsVsTopUsd: Math.max(0, topCost - cumulativeCost),
      };
    }
  }

  // Budget hit or none crossed threshold — surface best-effort result.
  if (best === undefined) {
    throw new BrainLLMError({
      code: 'BUDGET_EXHAUSTED',
      message: 'cascade exhausted budget before producing any response',
      retryable: false,
    });
  }
  const topCost = costAtTopOfLadder(req, steps);
  return {
    response: best.response,
    modelUsed: best.model,
    steps: steps.length,
    totalCostUsd: cumulativeCost,
    savingsVsTopUsd: Math.max(0, topCost - cumulativeCost),
  };
}

/** Heuristic token count: 4 chars ≈ 1 token. */
function estimateInputTokens(req: BrainLLMRequest): number {
  let chars = req.system?.length ?? 0;
  for (const m of req.messages) {
    for (const c of m.content) {
      if (c.type === 'text') chars += c.text.length;
    }
  }
  return Math.ceil(chars / 4);
}

/** Hypothetical cost if we had gone straight to the most expensive model. */
function costAtTopOfLadder(req: BrainLLMRequest, steps: readonly CascadeStep[]): number {
  const top = steps[steps.length - 1]!;
  const pricing = getPricing(top.model);
  const inputTokens = estimateInputTokens(req);
  const outputTokens = req.maxTokens ?? 4096;
  return computeCost({ inputTokens, outputTokens }, pricing).usd;
}

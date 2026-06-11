/**
 * `@borjie/llm-budget-governor` — cost-weighted metering (BSCHEMA-2).
 *
 * The metering UNIT is the COST-WEIGHTED TOKEN, not the raw token and not
 * the message (billing-claude-code-model.md §1.3). Opus consumes
 * meaningfully more quota per token than Sonnet, which consumes more than
 * Haiku — so the meter weights each model's tokens by its $/M list price.
 * This mirrors Anthropic's "normalize heterogeneous model spend into one
 * billable unit" (CCU) pattern (doc §1.3 / §3.2).
 *
 * Pure functions only. No state, no I/O, no Date — the "one weak axis"
 * the task allows is keeping this a deterministic pure helper.
 *
 * Per-model list price in USD per MILLION tokens (doc §1.3 / §1.5):
 *   Opus    $5 in  / $25 out
 *   Sonnet  $3 in  / $15 out
 *   Haiku   $1 in  / $5  out
 */

import type { ModelTier } from '../types.js';

/** USD price per MILLION tokens, split input/output. Source: doc §1.3. */
export interface ModelPrice {
  /** USD per 1M INPUT tokens. */
  readonly inputPerMillionUsd: number;
  /** USD per 1M OUTPUT tokens. */
  readonly outputPerMillionUsd: number;
}

/**
 * The canonical 2026 Anthropic list-price card (doc §1.3 / §1.5). Frozen.
 * These are the rates the overage fallback also anchors to ("drop to
 * pay-as-you-go API pricing once the subscription budget is spent").
 */
export const MODEL_PRICE_CARD: Readonly<Record<ModelTier, ModelPrice>> =
  Object.freeze({
    haiku: Object.freeze({ inputPerMillionUsd: 1, outputPerMillionUsd: 5 }),
    sonnet: Object.freeze({ inputPerMillionUsd: 3, outputPerMillionUsd: 15 }),
    opus: Object.freeze({ inputPerMillionUsd: 5, outputPerMillionUsd: 25 }),
  });

/**
 * The reference model for cost-weighting. Sonnet is the unit anchor: a
 * Sonnet token weighs ~1.0; Opus weighs ~1.7× (doc §1.3). The weight is
 * derived from the price card so the catalog and the meter never drift.
 */
const COST_WEIGHT_REFERENCE: ModelTier = 'sonnet';

const TOKENS_PER_MILLION = 1_000_000 as const;
const CENTS_PER_USD = 100 as const;

function priceFor(model: ModelTier): ModelPrice {
  const price = MODEL_PRICE_CARD[model];
  if (!price) {
    throw new Error(`Unknown model tier for pricing: ${String(model)}`);
  }
  return price;
}

function assertNonNegativeInt(label: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
}

/**
 * Raw USD cost of a call (input + output), as a float. Internal helper —
 * callers should prefer the integer-cents or cost-weighted-token surfaces
 * below so we never carry float dollars through the meter.
 */
function rawCostUsd(
  model: ModelTier,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = priceFor(model);
  const inCost = (inputTokens / TOKENS_PER_MILLION) * price.inputPerMillionUsd;
  const outCost =
    (outputTokens / TOKENS_PER_MILLION) * price.outputPerMillionUsd;
  return inCost + outCost;
}

/**
 * Integer-CENTS cost of a call. Rounds to the nearest cent. This is what
 * feeds `tenant_llm_budgets.spend_cents` (money tracked in cents — never
 * float dollars; see types.ts).
 */
export function callCostCents(
  model: ModelTier,
  inputTokens: number,
  outputTokens: number,
): number {
  assertNonNegativeInt('inputTokens', inputTokens);
  assertNonNegativeInt('outputTokens', outputTokens);
  return Math.round(rawCostUsd(model, inputTokens, outputTokens) * CENTS_PER_USD);
}

/**
 * COST-WEIGHTED TOKEN units for a call — the meter's billable unit
 * (doc §1.3). Computed as: the call's USD cost re-expressed in
 * "reference-model-equivalent tokens" so heterogeneous model spend
 * collapses to one axis.
 *
 *   weightedTokens = callCostUsd / referenceBlendedUsdPerToken
 *
 * where the reference blended $/token uses a 50/50 input/output mix of the
 * reference model (Sonnet). The effect: 1 Sonnet token (at the mix) ≈ 1
 * weighted unit; 1 Opus token ≈ ~1.7 weighted units; 1 Haiku token ≈ ~0.33
 * — exactly the doc's cost-weighting. Pure, deterministic, no rounding of
 * the unit itself (the caller decides where to round/floor).
 */
export function costWeightedTokens(
  model: ModelTier,
  inputTokens: number,
  outputTokens: number,
): number {
  assertNonNegativeInt('inputTokens', inputTokens);
  assertNonNegativeInt('outputTokens', outputTokens);
  if (inputTokens === 0 && outputTokens === 0) return 0;

  const refPrice = priceFor(COST_WEIGHT_REFERENCE);
  // Blended reference $/token over a 50/50 in/out mix.
  const refBlendedUsdPerToken =
    (refPrice.inputPerMillionUsd + refPrice.outputPerMillionUsd) /
    2 /
    TOKENS_PER_MILLION;

  const usd = rawCostUsd(model, inputTokens, outputTokens);
  return usd / refBlendedUsdPerToken;
}

/**
 * The multiplicative cost-weight of a model relative to the reference
 * (Sonnet = 1.0). Surfaced for tests / disclosure copy ("Opus costs ~1.7×
 * your budget per token"). Uses the output rate as the representative
 * weight since output dominates real spend.
 */
export function modelCostWeight(model: ModelTier): number {
  const ref = priceFor(COST_WEIGHT_REFERENCE).outputPerMillionUsd;
  return priceFor(model).outputPerMillionUsd / ref;
}

/**
 * Per-model pricing table (Q2 2026 — research §6 Pareto frontier).
 *
 * Prices are USD per 1,000,000 tokens. Sourced from research §6 + provider
 * canonical price pages (Anthropic, OpenAI, Google).
 *
 * Anthropic Bedrock/Vertex variants are priced identically to Direct
 * (same weights, same per-token rate). We map them via `normaliseModel`.
 */

import type { ModelPricing, ModelTier } from '../types.js';

/** Strip @cloud suffix and provider prefix so pricing lookups normalise. */
export function normaliseModel(model: ModelTier): string {
  const at = model.indexOf('@');
  const base = at === -1 ? model : model.slice(0, at);
  const slash = base.indexOf('/');
  return slash === -1 ? base : base.slice(slash + 1);
}

export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = Object.freeze({
  // ── Anthropic Claude family ─────────────────────────────────────────
  'claude-opus-4-7': { inputPerMillion: 15, outputPerMillion: 75 },
  'claude-opus-4-6': { inputPerMillion: 15, outputPerMillion: 75 },
  'claude-sonnet-4-6': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-haiku-4-5': { inputPerMillion: 1, outputPerMillion: 5 },
  // ── OpenAI GPT family (research §6) ─────────────────────────────────
  'gpt-5-pro': { inputPerMillion: 8, outputPerMillion: 32 },
  'gpt-5': { inputPerMillion: 3, outputPerMillion: 15 },
  'gpt-5-mini': { inputPerMillion: 0.75, outputPerMillion: 3 },
  'gpt-5-nano': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  // ── Google Gemini family ────────────────────────────────────────────
  'gemini-3-1-pro': { inputPerMillion: 3.5, outputPerMillion: 14 },
  // ── Open-source self-hosted (zero marginal cost; cap accounting) ────
  'qwen-3-6-plus': { inputPerMillion: 0.2, outputPerMillion: 0.4 },
  'minimax-m2-7': { inputPerMillion: 0.3, outputPerMillion: 0.6 },
});

/** Default pricing when model not in table (conservative; routes can still gate). */
const DEFAULT_PRICING: ModelPricing = Object.freeze({ inputPerMillion: 5, outputPerMillion: 20 });

export function getPricing(model: ModelTier): ModelPricing {
  const key = normaliseModel(model);
  return MODEL_PRICING[key] ?? DEFAULT_PRICING;
}

/**
 * Compute USD cost from a usage record + pricing.
 *
 * Pure function. Returns `{ usd: number }` with cache discount applied if
 * provider returned cache token counts.
 */
export function computeCost(
  usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens?: number;
    readonly cacheWriteTokens?: number;
  },
  pricing: ModelPricing
): { usd: number } {
  const input = (usage.inputTokens / 1_000_000) * pricing.inputPerMillion;
  const output = (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
  const cacheRead =
    pricing.cacheReadPerMillion !== undefined && usage.cacheReadTokens !== undefined
      ? (usage.cacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion
      : 0;
  const cacheWrite =
    pricing.cacheWritePerMillion !== undefined && usage.cacheWriteTokens !== undefined
      ? (usage.cacheWriteTokens / 1_000_000) * pricing.cacheWritePerMillion
      : 0;
  return { usd: input + output + cacheRead + cacheWrite };
}

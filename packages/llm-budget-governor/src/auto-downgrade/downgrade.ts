/**
 * Auto-downgrade ladder: opus → sonnet → haiku.
 *
 * Pure functions. Caller decides whether to act on the returned tier.
 */

import { MODEL_TIERS, type ModelTier } from '../types.js';

/**
 * Return the next-cheapest tier permitted for this tenant.
 * Returns `null` when there is nothing cheaper allowed.
 */
export function nextAllowedTier(
  current: ModelTier,
  allowed: ReadonlyArray<ModelTier>,
): ModelTier | null {
  const idx = MODEL_TIERS.indexOf(current);
  if (idx <= 0) return null;
  for (let i = idx - 1; i >= 0; i--) {
    const candidate = MODEL_TIERS[i];
    if (candidate && allowed.includes(candidate)) return candidate;
  }
  return null;
}

/**
 * Project the cost of a call using the per-1k-tokens cost table.
 * Returns cents.
 */
export function projectCallCostCents(
  estimatedTokens: number,
  tier: ModelTier,
  costPer1k: { readonly haiku: number; readonly sonnet: number; readonly opus: number },
): number {
  const per1k = tier === 'opus' ? costPer1k.opus : tier === 'sonnet' ? costPer1k.sonnet : costPer1k.haiku;
  return Math.round((estimatedTokens * per1k) / 1000);
}

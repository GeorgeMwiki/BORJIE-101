/**
 * Model tiering — pick the CHEAPEST capable model for the work at hand,
 * escalating only when complexity demands (per the performance rules:
 * Haiku-class for high-frequency / lightweight work; Sonnet-class for the
 * main path; Opus-class only for the deepest reasoning).
 *
 * This is a PURE policy: it maps a (route, stakes) pair onto a model TIER
 * label. The kernel/composition root maps the tier label onto a concrete
 * model id for the wired provider — this module deliberately does not
 * hard-code provider model strings into the routing logic so the policy
 * stays provider-agnostic and testable.
 *
 * FLAGGING: the tiering is gated by `BORJIE_MODEL_TIERING` (resolved by
 * {@link resolveModelTieringEnabled}); default OFF ⇒ CURRENT behavior (the
 * kernel's existing default model is used unchanged). When ON, a fast-lane
 * trivial turn is downshifted to the cheap tier.
 *
 * @module @borjie/central-intelligence/kernel/model-tiering
 */

import type { ThoughtRequest } from './kernel-types.js';

/** Capability tiers, cheapest → most capable. */
export type ModelTier = 'cheap' | 'standard' | 'deep';

export interface ModelTierDecision {
  readonly tier: ModelTier;
  readonly reason: string;
}

export interface SelectModelTierArgs {
  /** The fast-path routing decision ('fast' downshifts to cheap). */
  readonly route: 'fast' | 'full';
  readonly req: ThoughtRequest;
}

/**
 * Select the model tier for a turn. Pure + deterministic.
 *
 *   - fast lane                       → 'cheap' (Haiku-class)
 *   - full lane, stakes critical      → 'deep'  (Opus-class)
 *   - full lane, synthesis/judge      → 'deep'
 *   - everything else                 → 'standard' (Sonnet-class)
 */
export function selectModelTier(args: SelectModelTierArgs): ModelTierDecision {
  const { route, req } = args;
  if (route === 'fast') {
    return { tier: 'cheap', reason: 'fast-lane' };
  }
  if (req.stakes === 'critical') {
    return { tier: 'deep', reason: 'stakes=critical' };
  }
  if (req.requireSynthesis === true || req.requireJudge === true) {
    return { tier: 'deep', reason: 'deep-reasoning-requested' };
  }
  return { tier: 'standard', reason: 'default' };
}

/**
 * Resolve a concrete model id for a tier from a caller-supplied tier→id map,
 * falling back to a provided default when the tier is unmapped. Returns
 * `null` when no mapping AND no default is available (caller then keeps the
 * kernel's existing default — no behaviour change).
 */
export function resolveModelIdForTier(
  tier: ModelTier,
  map: Readonly<Partial<Record<ModelTier, string>>> | undefined,
  fallback?: string,
): string | null {
  const mapped = map?.[tier];
  if (typeof mapped === 'string' && mapped.length > 0) return mapped;
  if (typeof fallback === 'string' && fallback.length > 0) return fallback;
  return null;
}

/**
 * Resolve the master flag for model tiering. Default OFF ⇒ the kernel's
 * existing model choice is used unchanged (CURRENT behavior).
 *
 * Truthy: `1`, `true`, `on`, `yes`. Anything else (incl. UNSET) ⇒ off.
 */
export function resolveModelTieringEnabled(
  env: Readonly<Record<string, string | undefined>> = typeof process !== 'undefined' &&
  process.env
    ? process.env
    : {},
): boolean {
  const raw =
    typeof env.BORJIE_MODEL_TIERING === 'string'
      ? env.BORJIE_MODEL_TIERING.trim().toLowerCase()
      : '';
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}

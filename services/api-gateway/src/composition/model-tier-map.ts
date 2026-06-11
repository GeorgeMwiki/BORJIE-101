/**
 * Intelligence-Elasticity — the composition-root tier→model-id map.
 *
 * THE one place gateway composition resolves a concrete model id from a
 * capability tier (`'cheap' | 'standard' | 'deep'`). No wiring file may
 * pin a literal model id (every literal is a RESISTOR) — swapping the
 * brain to a smarter model is ONE change against this resolution:
 *
 *   1. `BORJIE_MODEL_TIER_<CHEAP|STANDARD|DEEP>` env — explicit
 *      operator pin per tier (wins outright).
 *   2. dynamic model registry `getModelLatest(family)` — L1 TTL cache →
 *      L2 live `/v1/models` → L3 baselines. The L3 baselines (operator-
 *      overridable via `BORJIE_MODEL_BASELINE_<FAMILY>`) default to
 *      EXACTLY the ids the wiring files shipped with, so runtime
 *      behavior is unchanged until the registry/env says otherwise.
 *
 * Resolution is PER-CALL (the `critics/haiku-critic.ts` precedent),
 * never frozen at module load, so registry freshness + env-map changes
 * apply without touching call-site code.
 *
 * Tier→family policy mirrors `selectModelTier` in
 * `@borjie/central-intelligence/kernel/model-tiering`:
 * cheap=Haiku-class, standard=Sonnet-class, deep=Opus-class.
 */

import { resolveModelIdForTier, type ModelTier } from '@borjie/central-intelligence';
import {
  getModelLatest,
  tierFamilyByCapability,
} from '@borjie/brain-llm-router/dynamic-registry';

export type { ModelTier } from '@borjie/central-intelligence';

// Tier→family is RANK-DRIVEN (intelligence-elasticity): deep = the front of
// the Anthropic capability rank (Fable today), standard = next, cheap = floor.
// A superior new Anthropic model (a `claude-fable-*` minor via L2, or a family
// ranked above Fable in FAMILY_CAPABILITY_RANK / BORJIE_ANTHROPIC_RANK) takes
// core reasoning automatically — zero call-site change.

const TIER_ENV_KEY: Readonly<Record<ModelTier, string>> = Object.freeze({
  cheap: 'BORJIE_MODEL_TIER_CHEAP',
  standard: 'BORJIE_MODEL_TIER_STANDARD',
  deep: 'BORJIE_MODEL_TIER_DEEP',
});

export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Read the env-backed tier→model-id override map. Unset/blank entries
 * are absent so `resolveModelIdForTier` falls through to the registry.
 */
export function readTierModelMap(
  env: EnvSource = process.env,
): Readonly<Partial<Record<ModelTier, string>>> {
  const entries = (Object.keys(TIER_ENV_KEY) as ReadonlyArray<ModelTier>)
    .map((tier) => [tier, env[TIER_ENV_KEY[tier]]?.trim()] as const)
    .filter(
      (pair): pair is readonly [ModelTier, string] =>
        typeof pair[1] === 'string' && pair[1].length > 0,
    );
  return Object.freeze(
    Object.fromEntries(entries) as Partial<Record<ModelTier, string>>,
  );
}

/**
 * Resolve the concrete model id for a tier. TOTAL — the registry's L3
 * baseline guarantees a valid id even with the provider unreachable and
 * no env overrides set.
 */
export function resolveTierModel(
  tier: ModelTier,
  env: EnvSource = process.env,
): string {
  const registryDefault = getModelLatest(tierFamilyByCapability(tier, env));
  return (
    resolveModelIdForTier(tier, readTierModelMap(env), registryDefault) ??
    registryDefault
  );
}

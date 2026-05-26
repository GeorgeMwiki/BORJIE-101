/**
 * fitness-scorer — composite recipe fitness in [0..1].
 *
 *   score = 0.5 * first_submit_acceptance_rate
 *         + 0.3 * (1 - revision_rate)
 *         + 0.2 * (1 - regulator_flag_count_normalised)
 *
 * regulator_flag_count is normalised by dividing by the composition
 * count, capped at 1. Zero compositions in the window yield score = 0
 * (no signal; the worker treats this as `hold`).
 */

import type { RecipeFitnessScore, RecipeFitnessStats } from '../types.js';

export const W_ACCEPTANCE = 0.5;
export const W_REVISION = 0.3;
export const W_REGULATOR = 0.2;

export function scoreFitness(stats: RecipeFitnessStats): RecipeFitnessScore {
  if (stats.composition_count === 0) {
    return {
      recipe_id: stats.recipe_id,
      recipe_version: stats.recipe_version,
      tenant_id: stats.tenant_id,
      score: 0,
      components: {
        acceptance_component: 0,
        revision_component: 0,
        regulator_component: 0,
      },
    };
  }

  const acceptanceComponent =
    W_ACCEPTANCE * clamp01(stats.first_submit_acceptance_rate);
  const revisionComponent =
    W_REVISION * clamp01(1 - clamp01(stats.revision_rate));

  const normalisedFlags = clamp01(
    stats.regulator_flag_count / Math.max(1, stats.composition_count),
  );
  const regulatorComponent = W_REGULATOR * (1 - normalisedFlags);

  const score = clamp01(
    acceptanceComponent + revisionComponent + regulatorComponent,
  );

  return {
    recipe_id: stats.recipe_id,
    recipe_version: stats.recipe_version,
    tenant_id: stats.tenant_id,
    score,
    components: {
      acceptance_component: acceptanceComponent,
      revision_component: revisionComponent,
      regulator_component: regulatorComponent,
    },
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

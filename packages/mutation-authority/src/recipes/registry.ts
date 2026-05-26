/**
 * Mutation-recipe registry — versioned, immutable.
 *
 * Recipes are platform-level (NOT tenant-scoped) declarations. Per-
 * tenant overrides live in `approval_policy_actions` (Wave 6 K5).
 *
 * Registration is append-only — bumping behaviour requires a new
 * `version` and the previous version moves to `locked`. Mirrors the
 * tab-recipe / doc-recipe lock-improve pattern from 17B / 17D.
 */

import type { MutationRecipe, RecipeStatus } from '../types.js';

type RegistryKey = `${string}::${number}`;

function keyFor(recipeId: string, version: number): RegistryKey {
  return `${recipeId}::${version}`;
}

export class MutationRecipeRegistry {
  private readonly recipes: ReadonlyMap<RegistryKey, MutationRecipe>;

  constructor(seed: ReadonlyArray<MutationRecipe> = []) {
    const map = new Map<RegistryKey, MutationRecipe>();
    for (const recipe of seed) {
      map.set(keyFor(recipe.id, recipe.version), recipe);
    }
    this.recipes = map;
  }

  /**
   * Append a recipe. If `(id, version)` exists this throws — recipes
   * are immutable; behaviour change requires a new version.
   */
  register(recipe: MutationRecipe): MutationRecipeRegistry {
    const k = keyFor(recipe.id, recipe.version);
    if (this.recipes.has(k)) {
      throw new Error(
        `mutation-authority: recipe ${recipe.id}@${recipe.version} already registered`,
      );
    }
    const next = new Map(this.recipes);
    next.set(k, recipe);
    return new MutationRecipeRegistry([...next.values()]);
  }

  get(recipeId: string, version: number): MutationRecipe | null {
    return this.recipes.get(keyFor(recipeId, version)) ?? null;
  }

  /**
   * Return the highest-version recipe for `recipeId` that matches the
   * status filter. Defaults to `live`.
   */
  resolveLatest(
    recipeId: string,
    status: RecipeStatus = 'live',
  ): MutationRecipe | null {
    let best: MutationRecipe | null = null;
    for (const recipe of this.recipes.values()) {
      if (recipe.id !== recipeId) continue;
      if (recipe.status !== status) continue;
      if (best === null || recipe.version > best.version) {
        best = recipe;
      }
    }
    return best;
  }

  list(): ReadonlyArray<MutationRecipe> {
    return [...this.recipes.values()];
  }
}

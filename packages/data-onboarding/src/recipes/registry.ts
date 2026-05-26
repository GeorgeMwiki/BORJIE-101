/**
 * Recipe registry for data-onboarding.
 *
 * Closed set of recipes — workforce, parcels, buyers. Each carries a
 * version + status; the registry exposes `byEntityType` for routing
 * an incoming feed to the correct recipe, and `live` filter helpers.
 */

import type { DataOnboardingRecipe, EntityType } from '../types.js';
import { DataOnboardingError } from '../types.js';
import { workerOnboardingRecipe } from './worker-onboarding.js';
import { parcelOnboardingRecipe } from './parcel-onboarding.js';
import { buyerOnboardingRecipe } from './buyer-onboarding.js';

export const BUILT_IN_RECIPES: ReadonlyArray<DataOnboardingRecipe> =
  Object.freeze([
    workerOnboardingRecipe,
    parcelOnboardingRecipe,
    buyerOnboardingRecipe,
  ]);

export class DataOnboardingRecipeRegistry {
  private readonly recipes: ReadonlyMap<string, DataOnboardingRecipe>;
  private readonly byType: ReadonlyMap<EntityType, DataOnboardingRecipe>;

  constructor(
    recipes: ReadonlyArray<DataOnboardingRecipe> = BUILT_IN_RECIPES,
  ) {
    const byId = new Map<string, DataOnboardingRecipe>();
    const byType = new Map<EntityType, DataOnboardingRecipe>();
    for (const r of recipes) {
      byId.set(r.id, r);
      byType.set(r.entity_type, r);
    }
    this.recipes = byId;
    this.byType = byType;
  }

  get(id: string): DataOnboardingRecipe {
    const r = this.recipes.get(id);
    if (r === undefined) {
      throw new DataOnboardingError(
        'recipe_not_found',
        `recipe ${id} is not registered`,
      );
    }
    return r;
  }

  forEntityType(entity_type: EntityType): DataOnboardingRecipe | undefined {
    return this.byType.get(entity_type);
  }

  all(): ReadonlyArray<DataOnboardingRecipe> {
    return Object.freeze([...this.recipes.values()]);
  }

  live(): ReadonlyArray<DataOnboardingRecipe> {
    return Object.freeze(
      [...this.recipes.values()].filter((r) => r.status === 'live'),
    );
  }
}

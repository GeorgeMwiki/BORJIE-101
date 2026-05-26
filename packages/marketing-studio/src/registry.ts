/**
 * CampaignRecipeRegistry — versioned recipe lookup.
 *
 * Identical lifecycle semantics to document-templates `DocumentRecipeRegistry`:
 * a `locked` recipe refuses to be overwritten in-place; new versions
 * must be registered separately.
 */

import type { CampaignRecipe, RecipeStatus } from './types.js';
import { MarketingError } from './types.js';
import { investorAnnouncementRecipe } from './recipes/investor-announcement.js';
import { buyerAcquisitionRecipe } from './recipes/buyer-acquisition.js';
import { regulatoryTransparencyRecipe } from './recipes/regulatory-transparency.js';

export const BUILT_IN_RECIPES: ReadonlyArray<CampaignRecipe> = Object.freeze([
  investorAnnouncementRecipe,
  buyerAcquisitionRecipe,
  regulatoryTransparencyRecipe,
]);

interface VersionKey {
  readonly id: string;
  readonly version: number;
}

function versionKey(k: VersionKey): string {
  return `${k.id}@${k.version}`;
}

export class CampaignRecipeRegistry {
  readonly #entries: Map<string, CampaignRecipe>;

  public constructor(seed: ReadonlyArray<CampaignRecipe> = BUILT_IN_RECIPES) {
    this.#entries = new Map();
    for (const r of seed) {
      this.#entries.set(versionKey(r), r);
    }
  }

  public get(id: string, version: number): CampaignRecipe | null {
    return this.#entries.get(versionKey({ id, version })) ?? null;
  }

  public getLive(id: string): CampaignRecipe | null {
    let best: CampaignRecipe | null = null;
    for (const recipe of this.#entries.values()) {
      if (recipe.id !== id) continue;
      if (recipe.status !== 'live' && recipe.status !== 'locked') continue;
      if (best === null || recipe.version > best.version) {
        best = recipe;
      }
    }
    return best;
  }

  public list(): ReadonlyArray<CampaignRecipe> {
    return Array.from(this.#entries.values());
  }

  public register(recipe: CampaignRecipe): CampaignRecipeRegistry {
    const key = versionKey(recipe);
    const existing = this.#entries.get(key);
    if (existing !== undefined && existing.status === 'locked') {
      throw new MarketingError(
        'STATE_TRANSITION_REFUSED',
        `cannot overwrite locked recipe ${recipe.id}@${recipe.version}`,
        [recipe.id, String(recipe.version)],
      );
    }
    const next = new CampaignRecipeRegistry(Array.from(this.#entries.values()));
    next.#entries.set(key, recipe);
    return next;
  }

  public listByStatus(status: RecipeStatus): ReadonlyArray<CampaignRecipe> {
    const out: Array<CampaignRecipe> = [];
    for (const r of this.#entries.values()) {
      if (r.status === status) out.push(r);
    }
    return Object.freeze(out);
  }
}

/**
 * MediaRecipeRegistry — versioned recipe lookup.
 *
 * Mirrors `DocumentRecipeRegistry`. Pure-functional registry; the
 * underlying store is a `Map` keyed on `(id, version)`. The 3 seed
 * recipes (`briefing_thumbnail`, `marketplace_listing_hero`,
 * `social_post_still`) are loaded at construction. New recipes ship
 * via the dynamic author (Wave 18M).
 *
 * Lock policy mirrors the spec: a `locked` recipe refuses to be
 * overwritten in-place.
 *
 * @module @borjie/media-generation/registry
 */

import type { MediaRecipe, MediaRecipeStatus, MediaClass } from './types.js';
import { MediaCompositionError } from './types.js';
import { briefingThumbnailRecipe } from './recipes/briefing-thumbnail.js';
import { marketplaceListingHeroRecipe } from './recipes/marketplace-listing-hero.js';
import { socialPostStillRecipe } from './recipes/social-post-still.js';

export const BUILT_IN_RECIPES: ReadonlyArray<MediaRecipe> = Object.freeze([
  briefingThumbnailRecipe,
  marketplaceListingHeroRecipe,
  socialPostStillRecipe,
]);

interface VersionKey {
  readonly id: string;
  readonly version: number;
}

function versionKey(k: VersionKey): string {
  return `${k.id}@${k.version}`;
}

export class MediaRecipeRegistry {
  readonly #entries: Map<string, MediaRecipe>;

  public constructor(seed: ReadonlyArray<MediaRecipe> = BUILT_IN_RECIPES) {
    this.#entries = new Map();
    for (const r of seed) {
      this.#entries.set(versionKey(r), r);
    }
  }

  /** Lookup by `(id, version)`. Returns `null` when missing. */
  public get(id: string, version: number): MediaRecipe | null {
    return this.#entries.get(versionKey({ id, version })) ?? null;
  }

  /** Return the highest-version `live` or `locked` recipe for the id. */
  public getLive(id: string): MediaRecipe | null {
    let best: MediaRecipe | null = null;
    for (const recipe of this.#entries.values()) {
      if (recipe.id !== id) continue;
      if (recipe.status !== 'live' && recipe.status !== 'locked') continue;
      if (best === null || recipe.version > best.version) {
        best = recipe;
      }
    }
    return best;
  }

  /** Enumerate every registered version. */
  public list(): ReadonlyArray<MediaRecipe> {
    return Array.from(this.#entries.values());
  }

  /** Register a new recipe version. Refuses to overwrite a locked
   *  recipe in-place (spec §11 anti-pattern). */
  public register(recipe: MediaRecipe): MediaRecipeRegistry {
    const key = versionKey(recipe);
    const existing = this.#entries.get(key);
    if (existing !== undefined && existing.status === 'locked') {
      throw new MediaCompositionError(
        'STATE_TRANSITION_REFUSED',
        `cannot overwrite locked recipe ${recipe.id}@${recipe.version}`,
        [recipe.id, String(recipe.version)],
      );
    }
    const next = new MediaRecipeRegistry(Array.from(this.#entries.values()));
    next.#entries.set(key, recipe);
    return next;
  }

  /** Filter by status. */
  public listByStatus(status: MediaRecipeStatus): ReadonlyArray<MediaRecipe> {
    return this.list().filter((r) => r.status === status);
  }

  /** Filter by media class. */
  public listByClass(cls: MediaClass): ReadonlyArray<MediaRecipe> {
    return this.list().filter((r) => r.class === cls);
  }
}

/** Shared singleton — convenient default for callers that don't need
 *  custom shadow / draft versions. */
export const defaultMediaRecipeRegistry: MediaRecipeRegistry =
  new MediaRecipeRegistry();

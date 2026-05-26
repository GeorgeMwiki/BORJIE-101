/**
 * DocumentRecipeRegistry — versioned recipe lookup.
 *
 * Pure-functional registry; the underlying store is just a `Map`
 * keyed on `(id, version)`. The 11 closed-set recipes are seeded at
 * construction. Caller can register additional versions (shadow /
 * draft) but must observe the lock policy (a `locked` recipe refuses
 * to be overwritten in-place per spec §7).
 */

import type { DocumentRecipe, RecipeStatus } from './types.js';
import { CompositionError } from './types.js';
import { dailyBriefingRecipe } from './recipes/daily-briefing.js';
import { boardReportRecipe } from './recipes/board-report.js';
import { investorBriefingRecipe } from './recipes/investor-briefing.js';
import { tumemadiniReturnRecipe } from './recipes/tumemadini-return.js';
import { nemcFilingRecipe } from './recipes/nemc-filing.js';
import { buyerKybPackRecipe } from './recipes/buyer-kyb-pack.js';
import { sopRecipe } from './recipes/sop.js';
import { financialModelRecipe } from './recipes/financial-model.js';
import { contractRecipe } from './recipes/contract.js';
import { geologicalReportRecipe } from './recipes/geological-report.js';
import { marketplaceListingRecipe } from './recipes/marketplace-listing.js';

export const BUILT_IN_RECIPES: ReadonlyArray<DocumentRecipe> = Object.freeze([
  dailyBriefingRecipe,
  boardReportRecipe,
  investorBriefingRecipe,
  tumemadiniReturnRecipe,
  nemcFilingRecipe,
  buyerKybPackRecipe,
  sopRecipe,
  financialModelRecipe,
  contractRecipe,
  geologicalReportRecipe,
  marketplaceListingRecipe,
]);

interface VersionKey {
  readonly id: string;
  readonly version: number;
}

function versionKey(k: VersionKey): string {
  return `${k.id}@${k.version}`;
}

export class DocumentRecipeRegistry {
  readonly #entries: Map<string, DocumentRecipe>;

  public constructor(seed: ReadonlyArray<DocumentRecipe> = BUILT_IN_RECIPES) {
    this.#entries = new Map();
    for (const r of seed) {
      this.#entries.set(versionKey(r), r);
    }
  }

  /** Lookup by `(id, version)`. Returns `null` when missing. */
  public get(id: string, version: number): DocumentRecipe | null {
    return this.#entries.get(versionKey({ id, version })) ?? null;
  }

  /** Return the highest-version `live` recipe for the given id. */
  public getLive(id: string): DocumentRecipe | null {
    let best: DocumentRecipe | null = null;
    for (const recipe of this.#entries.values()) {
      if (recipe.id !== id) continue;
      if (recipe.status !== 'live' && recipe.status !== 'locked') continue;
      if (best === null || recipe.version > best.version) {
        best = recipe;
      }
    }
    return best;
  }

  /** Enumerate every registered version. Useful for the lock/improve
   *  worker and registry inspection endpoints. */
  public list(): ReadonlyArray<DocumentRecipe> {
    return Array.from(this.#entries.values());
  }

  /** Register a new recipe version. Refuses to overwrite a locked
   *  recipe in-place (spec §7). */
  public register(recipe: DocumentRecipe): DocumentRecipeRegistry {
    const key = versionKey(recipe);
    const existing = this.#entries.get(key);
    if (existing !== undefined && existing.status === 'locked') {
      throw new CompositionError(
        'STATE_TRANSITION_REFUSED',
        `cannot overwrite locked recipe ${recipe.id}@${recipe.version}`,
        [recipe.id, String(recipe.version)],
      );
    }
    const next = new DocumentRecipeRegistry(Array.from(this.#entries.values()));
    next.#entries.set(key, recipe);
    return next;
  }

  /** Filter by status. */
  public listByStatus(status: RecipeStatus): ReadonlyArray<DocumentRecipe> {
    return this.list().filter((r) => r.status === status);
  }

  /** Filter by document class. */
  public listByClass(cls: DocumentRecipe['class']): ReadonlyArray<DocumentRecipe> {
    return this.list().filter((r) => r.class === cls);
  }
}

/** Shared singleton — convenient default for callers that don't need
 *  custom shadow/draft versions. */
export const defaultRecipeRegistry: DocumentRecipeRegistry = new DocumentRecipeRegistry();

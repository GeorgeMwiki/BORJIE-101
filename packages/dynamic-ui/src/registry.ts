/**
 * TabRecipeRegistry — versioned lookup for Tab Recipes.
 *
 * Backing the spec's §3 contract + §4 lock-vs-improve policy:
 *
 *  - Recipes are versioned. `(id, version)` is immutable once published.
 *  - At any moment a recipe can have at most ONE `live` version and at
 *    most ONE `shadow` version per id. `draft` and `deprecated` versions
 *    may stack freely. `locked` is a terminal `live` state.
 *  - `lookup(id)` returns the live recipe + the shadow recipe (if any)
 *    so the renderer can run shadow alongside live without leaking the
 *    shadow into the operator's view.
 *
 * The registry is pure in-memory. Persistence (the `tab_recipes` table
 * in §9) lands in Phase 2 — for now production callers hydrate the
 * registry at boot.
 *
 * Immutability discipline:
 *   - `register` returns a NEW registry — never mutates the receiver.
 *   - The recipe Map is held in a private field with `readonly` semantic
 *     access via `list()` so consumers cannot reach in and mutate.
 */

import type { TabRecipe, TabRecipeStatus, RegistryLookup } from './types.js';

/**
 * Error thrown when the registry would enter an illegal state — e.g.
 * promoting two versions of the same recipe to `live` at once. Surfaced
 * by the worker / API gateway so a misconfigured rollout fails closed.
 */
export class TabRecipeRegistryError extends Error {
  public override readonly name = 'TabRecipeRegistryError';

  public constructor(message: string) {
    super(message);
  }
}

interface RegistryShape {
  readonly recipes: ReadonlyMap<string, ReadonlyArray<TabRecipe>>;
}

function freezeMap(
  entries: ReadonlyArray<readonly [string, ReadonlyArray<TabRecipe>]>,
): ReadonlyMap<string, ReadonlyArray<TabRecipe>> {
  return new Map(entries);
}

/**
 * Validate that for a given recipe id, the new set of versions still
 * obeys the single-live / single-shadow invariant.
 */
function validateInvariants(
  id: string,
  versions: ReadonlyArray<TabRecipe>,
): void {
  if (versions.length === 0) {
    return;
  }
  const seen = new Set<number>();
  for (const r of versions) {
    if (seen.has(r.version)) {
      throw new TabRecipeRegistryError(
        `duplicate version for recipe '${id}': v${r.version}`,
      );
    }
    seen.add(r.version);
  }
  const live = versions.filter((r) => r.status === 'live' || r.status === 'locked');
  const shadow = versions.filter((r) => r.status === 'shadow');
  if (live.length > 1) {
    throw new TabRecipeRegistryError(
      `recipe '${id}' has ${live.length} live/locked versions — only one allowed`,
    );
  }
  if (shadow.length > 1) {
    throw new TabRecipeRegistryError(
      `recipe '${id}' has ${shadow.length} shadow versions — only one allowed`,
    );
  }
}

function pickByStatus(
  versions: ReadonlyArray<TabRecipe>,
  status: TabRecipeStatus,
): TabRecipe | undefined {
  return versions.find((r) => r.status === status);
}

/**
 * Public API — immutable registry of Tab Recipes.
 *
 * Construct an empty registry and chain `.register(recipe)` calls; each
 * call returns a NEW registry instance. The original is untouched.
 */
export class TabRecipeRegistry {
  private readonly state: RegistryShape;

  public constructor(state?: RegistryShape) {
    this.state = state ?? { recipes: freezeMap([]) };
  }

  /** Returns a NEW registry with the recipe inserted / replaced. */
  public register(recipe: TabRecipe): TabRecipeRegistry {
    if (recipe.brand !== 'borjie') {
      throw new TabRecipeRegistryError(
        `recipe '${recipe.id}' has brand='${recipe.brand}'; expected 'borjie'`,
      );
    }
    if (!Number.isInteger(recipe.version) || recipe.version < 1) {
      throw new TabRecipeRegistryError(
        `recipe '${recipe.id}' has invalid version ${recipe.version}; must be positive integer`,
      );
    }
    const existing = this.state.recipes.get(recipe.id) ?? [];
    const nextVersions = [
      ...existing.filter((r) => r.version !== recipe.version),
      recipe,
    ];
    nextVersions.sort((a, b) => a.version - b.version);
    validateInvariants(recipe.id, nextVersions);
    const nextEntries: Array<readonly [string, ReadonlyArray<TabRecipe>]> = [];
    for (const [id, versions] of this.state.recipes.entries()) {
      if (id !== recipe.id) {
        nextEntries.push([id, versions]);
      }
    }
    nextEntries.push([recipe.id, nextVersions]);
    return new TabRecipeRegistry({ recipes: freezeMap(nextEntries) });
  }

  /**
   * Lookup the canonical (live + optional shadow) versions for a
   * recipe id. Returns `null` if no live version is bound.
   *
   * Why only live + shadow? See spec §4 — only those two states are
   * eligible to render. `draft` is editor-only, `deprecated` is
   * historical, `locked` rolls up under live.
   */
  public lookup(id: string): RegistryLookup | null {
    const versions = this.state.recipes.get(id);
    if (!versions || versions.length === 0) {
      return null;
    }
    const live = pickByStatus(versions, 'live') ?? pickByStatus(versions, 'locked');
    if (!live) {
      return null;
    }
    const shadow = pickByStatus(versions, 'shadow');
    if (shadow) {
      return {
        recipe: live,
        liveVersion: live.version,
        shadowVersion: shadow.version,
      };
    }
    return {
      recipe: live,
      liveVersion: live.version,
    };
  }

  /** Lookup a specific (id, version) — used by audit / verify flows. */
  public lookupVersion(id: string, version: number): TabRecipe | null {
    const versions = this.state.recipes.get(id);
    if (!versions) {
      return null;
    }
    return versions.find((r) => r.version === version) ?? null;
  }

  /** Lookup the (id, version) that is in `shadow` status for the id. */
  public lookupShadow(id: string): TabRecipe | null {
    const versions = this.state.recipes.get(id);
    if (!versions) {
      return null;
    }
    return pickByStatus(versions, 'shadow') ?? null;
  }

  /** Returns true if the live version is `locked`. */
  public isLocked(id: string): boolean {
    const versions = this.state.recipes.get(id);
    if (!versions) {
      return false;
    }
    return versions.some((r) => r.status === 'locked');
  }

  /** Enumerate all (id, versions[]) pairs — read-only snapshot. */
  public list(): ReadonlyArray<{
    readonly id: string;
    readonly versions: ReadonlyArray<TabRecipe>;
  }> {
    const out: Array<{
      readonly id: string;
      readonly versions: ReadonlyArray<TabRecipe>;
    }> = [];
    for (const [id, versions] of this.state.recipes.entries()) {
      out.push({ id, versions });
    }
    return out;
  }

  /** Lookup the bound recipe for an intent kind. */
  public lookupByIntent(intentKind: string): RegistryLookup | null {
    for (const [id, versions] of this.state.recipes.entries()) {
      const live = pickByStatus(versions, 'live') ?? pickByStatus(versions, 'locked');
      if (live && live.intent === intentKind) {
        return this.lookup(id);
      }
    }
    return null;
  }
}

/** Convenience factory — empty registry. */
export function createTabRecipeRegistry(): TabRecipeRegistry {
  return new TabRecipeRegistry();
}

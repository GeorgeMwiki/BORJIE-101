/**
 * `composeDoc` — Layer 2 dispatcher.
 *
 * Given a recipe id + version + compose context, resolves the recipe
 * from the registry, validates the registry-declared input contract,
 * and delegates to the recipe's `compose` function. Returns the
 * sealed `DocumentArtifact`.
 *
 * This is the single entry point the API gateway calls (per spec §10
 * `compose_doc_v1(recipe_id, intent_payload)`).
 */

import type { DocComposeContext, DocumentArtifact, DocumentRecipe } from './types.js';
import { CompositionError } from './types.js';
import { defaultRecipeRegistry, DocumentRecipeRegistry } from './registry.js';

export interface ComposeDocArgs {
  readonly recipe_id: string;
  readonly recipe_version?: number;
  readonly ctx: DocComposeContext;
  readonly registry?: DocumentRecipeRegistry;
}

export async function composeDoc(args: ComposeDocArgs): Promise<DocumentArtifact> {
  const registry = args.registry ?? defaultRecipeRegistry;
  const recipe = resolveRecipe(registry, args.recipe_id, args.recipe_version);
  assertRequiredInputs(recipe, args.ctx);
  return recipe.compose(args.ctx);
}

function resolveRecipe(
  registry: DocumentRecipeRegistry,
  id: string,
  version?: number,
): DocumentRecipe {
  if (version !== undefined) {
    const exact = registry.get(id, version);
    if (exact === null) {
      throw new CompositionError(
        'RECIPE_NOT_FOUND',
        `recipe ${id}@${version} not registered`,
        [id, String(version)],
      );
    }
    return exact;
  }
  const live = registry.getLive(id);
  if (live === null) {
    throw new CompositionError(
      'RECIPE_NOT_FOUND',
      `no live recipe with id ${id}`,
      [id],
    );
  }
  return live;
}

function assertRequiredInputs(recipe: DocumentRecipe, ctx: DocComposeContext): void {
  const available = new Set(ctx.available_data.map((d) => d.key));
  const missing = recipe.required_inputs
    .filter((i) => i.required)
    .filter((i) => !available.has(i.key))
    .map((i) => i.key);
  if (missing.length > 0) {
    throw new CompositionError(
      'INPUT_GAP',
      `composer refused: ${missing.length} required input(s) missing`,
      missing,
    );
  }
}

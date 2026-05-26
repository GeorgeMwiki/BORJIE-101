/**
 * `composeMedia` — Layer 2 dispatcher.
 *
 * Given a recipe id + version + compose context, resolves the recipe
 * from the registry and delegates to the recipe's `compose` function.
 * Returns the sealed `MediaArtifact`.
 *
 * Mirrors `composeDoc` from `@borjie/document-templates`.
 *
 * @module @borjie/media-generation/composer
 */

import type {
  MediaArtifact,
  MediaComposeContext,
  MediaRecipe,
} from './types.js';
import { MediaCompositionError } from './types.js';
import { defaultMediaRecipeRegistry, MediaRecipeRegistry } from './registry.js';

export interface ComposeMediaArgs {
  readonly recipe_id: string;
  readonly recipe_version?: number;
  readonly ctx: MediaComposeContext;
  readonly registry?: MediaRecipeRegistry;
}

export async function composeMedia(args: ComposeMediaArgs): Promise<MediaArtifact> {
  const registry = args.registry ?? defaultMediaRecipeRegistry;
  const recipe = resolveRecipe(registry, args.recipe_id, args.recipe_version);
  assertRequiredInputs(recipe, args.ctx);
  return recipe.compose(args.ctx);
}

function assertRequiredInputs(
  recipe: MediaRecipe,
  ctx: MediaComposeContext,
): void {
  const available = new Set(ctx.available_data.map((d) => d.key));
  const missing = recipe.required_prompt_inputs
    .filter((i) => i.required)
    .filter((i) => !available.has(i.key))
    .map((i) => i.key);
  if (missing.length > 0) {
    throw new MediaCompositionError(
      'INPUT_GAP',
      `composer refused: ${missing.length} required prompt input(s) missing`,
      missing,
    );
  }
}

function resolveRecipe(
  registry: MediaRecipeRegistry,
  id: string,
  version?: number,
): MediaRecipe {
  if (version !== undefined) {
    const exact = registry.get(id, version);
    if (exact === null) {
      throw new MediaCompositionError(
        'RECIPE_NOT_FOUND',
        `recipe ${id}@${version} not registered`,
        [id, String(version)],
      );
    }
    return exact;
  }
  const live = registry.getLive(id);
  if (live === null) {
    throw new MediaCompositionError(
      'RECIPE_NOT_FOUND',
      `no live recipe with id ${id}`,
      [id],
    );
  }
  return live;
}

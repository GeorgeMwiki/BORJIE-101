/**
 * Seed recipe: briefing_thumbnail.
 *
 * Class: briefing_thumbnail
 * Format: image, 1:1
 * Budget: ≤$0.10, ≤15 s
 * Tier: 0 (internal sketch, auto-publish to owner-only channels)
 *
 * Subject: morning-brief share card. Composer pulls headline overnight
 * event + FX delta + parcel deltas from joins; the rendered thumbnail
 * is the share card the owner sees at 06:00 owner-local.
 */

import { z } from 'zod';
import type {
  MediaArtifact,
  MediaComposeContext,
  MediaProviderAdapter,
  MediaProviderInput,
  MediaRecipe,
} from '../types.js';
import { readData, runRecipe } from './_helpers.js';
import { createFluxAdapter } from '../providers/flux-adapter.js';
import { createIdeogramAdapter } from '../providers/ideogram-adapter.js';
import { createImagenAdapter } from '../providers/imagen-adapter.js';

const HeadlineSchema = z
  .string()
  .min(1)
  .max(180)
  .default('Overnight events synthesised by Mr. Mwikila');

export function buildBriefingThumbnailRecipe(opts: {
  readonly adapters?: ReadonlyArray<
    MediaProviderAdapter<MediaProviderInput, MediaArtifact>
  >;
} = {}): MediaRecipe {
  const recipe: MediaRecipe = {
    id: 'briefing_thumbnail',
    class: 'briefing_thumbnail',
    version: 1,
    status: 'live',
    authority_tier: 0,
    brand: 'borjie',
    approval_required: false,
    output_format: 'image',
    target_aspect_ratio: '1:1',
    required_prompt_inputs: [
      {
        key: 'headline',
        description: 'One-line headline summarising the overnight events.',
        required: false,
      },
    ],
    compose: async (ctx: MediaComposeContext): Promise<MediaArtifact> => {
      const headline = HeadlineSchema.parse(readData<string>(ctx, 'headline'));
      const subject =
        `Briefing thumbnail share card. Centered headline text: "${headline}". ` +
        `Borjie wordmark in upper-left at 100% opacity. Background uses the ` +
        `signature gradient from anchor A to anchor B. Minimalist composition, ` +
        `square aspect ratio, suitable for use as a notification thumbnail.`;
      const adapters =
        opts.adapters ??
        [
          createFluxAdapter({
            recipe: pickRecipeKey(recipe),
            span_citations: ctx.citations,
          }),
          createIdeogramAdapter({
            recipe: pickRecipeKey(recipe),
            span_citations: ctx.citations,
          }),
          createImagenAdapter({
            recipe: pickRecipeKey(recipe),
            span_citations: ctx.citations,
          }),
        ];
      return runRecipe({
        recipe,
        ctx,
        capability: 'text_to_image',
        subject_prompt: subject,
        adapters,
        expect_wordmark: true,
      });
    },
  };
  return recipe;
}

function pickRecipeKey(
  r: MediaRecipe,
): {
  readonly id: string;
  readonly version: number;
  readonly class: typeof r.class;
  readonly authority_tier: typeof r.authority_tier;
  readonly approval_required: boolean;
} {
  return {
    id: r.id,
    version: r.version,
    class: r.class,
    authority_tier: r.authority_tier,
    approval_required: r.approval_required,
  };
}

export const briefingThumbnailRecipe: MediaRecipe = buildBriefingThumbnailRecipe();

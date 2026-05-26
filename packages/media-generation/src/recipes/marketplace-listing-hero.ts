/**
 * Seed recipe: marketplace_listing_hero.
 *
 * Class: marketplace_listing_hero
 * Format: image, 4:5
 * Budget: ≤$0.15, ≤30 s
 * Tier: 1 (staged for owner review, 24 h auto-promote)
 *
 * Subject: ore-parcel listing hero. Composer interpolates parcel id,
 * grade (g/t), tonnage, region, and assay-cert citation. Every claim
 * must reference a `SpanCitation`.
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
import { createRecraftAdapter } from '../providers/recraft-adapter.js';
import { createImagenAdapter } from '../providers/imagen-adapter.js';

const ParcelSchema = z.object({
  parcel_id: z.string().min(1),
  grade_g_per_t: z.number().nonnegative(),
  tonnage_t: z.number().nonnegative(),
  region: z.string().min(1),
  mineral: z.string().min(1),
});

type ParcelData = z.infer<typeof ParcelSchema>;

export function buildMarketplaceListingHeroRecipe(opts: {
  readonly adapters?: ReadonlyArray<
    MediaProviderAdapter<MediaProviderInput, MediaArtifact>
  >;
} = {}): MediaRecipe {
  const recipe: MediaRecipe = {
    id: 'marketplace_listing_hero',
    class: 'marketplace_listing_hero',
    version: 1,
    status: 'live',
    authority_tier: 1,
    brand: 'borjie',
    approval_required: false,
    output_format: 'image',
    target_aspect_ratio: '4:5',
    required_prompt_inputs: [
      {
        key: 'parcel',
        description: 'Parcel id + grade + tonnage + region + mineral.',
        required: true,
      },
    ],
    compose: async (ctx: MediaComposeContext): Promise<MediaArtifact> => {
      const raw = readData<ParcelData>(ctx, 'parcel');
      const parcel = ParcelSchema.parse(raw);
      const subject =
        `Marketplace listing hero image of ore parcel ${parcel.parcel_id}, ` +
        `${parcel.grade_g_per_t} g/t ${parcel.mineral} grade, ` +
        `${parcel.tonnage_t.toFixed(2)} tonnes, from the ${parcel.region} region. ` +
        `Documentary-style photograph of mineral concentrate on neutral surface, ` +
        `front-lit, shallow depth of field, signature gradient as backdrop. ` +
        `Borjie wordmark top-left at 100% opacity. Aspect ratio 4:5, suitable ` +
        `for vertical scroll on the marketplace listing page.`;
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
          createRecraftAdapter({
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

export const marketplaceListingHeroRecipe: MediaRecipe =
  buildMarketplaceListingHeroRecipe();

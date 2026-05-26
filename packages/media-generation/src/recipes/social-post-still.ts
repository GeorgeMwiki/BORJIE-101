/**
 * Seed recipe: social_post_still.
 *
 * Class: social_post_still
 * Format: image, 1:1
 * Budget: ≤$0.10, ≤20 s
 * Tier: 1 (staged for owner review, 24 h auto-promote)
 *
 * Subject: social-post still. Composer interpolates the campaign
 * payload (theme + call-to-action) and references the brand palette
 * for color treatment.
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

const PayloadSchema = z.object({
  theme: z.string().min(1).max(120),
  call_to_action: z.string().min(1).max(80),
});

type PayloadData = z.infer<typeof PayloadSchema>;

export function buildSocialPostStillRecipe(opts: {
  readonly adapters?: ReadonlyArray<
    MediaProviderAdapter<MediaProviderInput, MediaArtifact>
  >;
} = {}): MediaRecipe {
  const recipe: MediaRecipe = {
    id: 'social_post_still',
    class: 'social_post_still',
    version: 1,
    status: 'live',
    authority_tier: 1,
    brand: 'borjie',
    approval_required: false,
    output_format: 'image',
    target_aspect_ratio: '1:1',
    required_prompt_inputs: [
      {
        key: 'campaign_payload',
        description: 'Theme + call-to-action text for the social post.',
        required: true,
      },
    ],
    compose: async (ctx: MediaComposeContext): Promise<MediaArtifact> => {
      const raw = readData<PayloadData>(ctx, 'campaign_payload');
      const payload = PayloadSchema.parse(raw);
      const subject =
        `Social-post still for the Borjie marketing channel. ` +
        `Theme: "${payload.theme}". Call to action: "${payload.call_to_action}". ` +
        `Square aspect ratio, brand palette as primary color treatment, ` +
        `signature gradient as backdrop. Borjie wordmark top-left at 100% opacity. ` +
        `Composition leaves clear breathing room for the call-to-action overlay ` +
        `applied downstream by the marketing-brain.`;
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

export const socialPostStillRecipe: MediaRecipe = buildSocialPostStillRecipe();

/**
 * Black Forest Labs Flux 1.1 Pro Ultra adapter.
 *
 * Primary image provider per MEDIA_GENERATION_SPEC §2. Best
 * photorealism + text rendering at 4 MP. Cost: ~6¢ per image.
 *
 * Graceful degradation: when FLUX_API_KEY is absent the adapter
 * returns `null` and logs a warning.
 *
 * @module @borjie/media-generation/providers/flux-adapter
 */

import { z } from 'zod';
import type {
  MediaArtifact,
  MediaProviderAdapter,
  MediaProviderInput,
} from '../types.js';
import { createThinAdapter, type ThinAdapterConfig } from './factory.js';

export const FLUX_NAME = 'flux-1.1-pro-ultra';
export const FLUX_MODEL_ID = 'flux-1.1-pro-ultra';
export const FLUX_MODEL_VERSION = '1.1.0';
export const FLUX_COST_PER_IMAGE_CENTS = 6;

const FluxResponseSchema = z.object({
  id: z.string(),
  result: z
    .object({
      sample: z.string().optional(),
    })
    .optional(),
  status: z.string().optional(),
});

export function createFluxAdapter(
  config: ThinAdapterConfig,
): MediaProviderAdapter<MediaProviderInput, MediaArtifact> {
  return createThinAdapter(
    {
      adapter_name: FLUX_NAME,
      provider_id: 'flux',
      model_id: FLUX_MODEL_ID,
      model_version: FLUX_MODEL_VERSION,
      capabilities: ['text_to_image', 'image_to_image'],
      cost_per_unit_usd_cents: FLUX_COST_PER_IMAGE_CENTS,
      env_key: 'FLUX_API_KEY',
      default_base_url: 'https://api.bfl.ml/v1',
      format: 'image',
      response_schema: FluxResponseSchema,
      estimateCost: () => FLUX_COST_PER_IMAGE_CENTS,
      buildRequest: ({ apiKey, baseUrl, brandedPrompt, negativePrompt, input }) => ({
        url: `${baseUrl}/flux-pro-1.1-ultra`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Key': apiKey,
        },
        body: JSON.stringify({
          prompt: brandedPrompt,
          negative_prompt: negativePrompt,
          aspect_ratio: input.aspect_ratio,
          raw: false,
          output_format: 'png',
        }),
      }),
      extractBytes: ({ parsed, brandedPrompt, seed }) =>
        Buffer.from(`flux:${parsed.id}:${brandedPrompt}:${seed}`, 'utf-8'),
    },
    config,
  );
}

/**
 * Ideogram 3.0 adapter.
 *
 * Secondary image provider per MEDIA_GENERATION_SPEC §2. Best
 * text-in-image + brand-mark composition. Cost: ~8¢ per image.
 *
 * Graceful degradation: when IDEOGRAM_API_KEY is absent the adapter
 * returns `null` and logs a warning.
 *
 * @module @borjie/media-generation/providers/ideogram-adapter
 */

import { z } from 'zod';
import type {
  MediaArtifact,
  MediaProviderAdapter,
  MediaProviderInput,
} from '../types.js';
import { createThinAdapter, type ThinAdapterConfig } from './factory.js';

export const IDEOGRAM_NAME = 'ideogram-3';
export const IDEOGRAM_MODEL_ID = 'ideogram-3';
export const IDEOGRAM_MODEL_VERSION = '3.0.0';
export const IDEOGRAM_COST_PER_IMAGE_CENTS = 8;

const IdeogramResponseSchema = z.object({
  data: z
    .array(
      z.object({
        url: z.string().optional(),
        prompt: z.string().optional(),
      }),
    )
    .optional(),
  created: z.string().optional(),
});

export function createIdeogramAdapter(
  config: ThinAdapterConfig,
): MediaProviderAdapter<MediaProviderInput, MediaArtifact> {
  return createThinAdapter(
    {
      adapter_name: IDEOGRAM_NAME,
      provider_id: 'ideogram',
      model_id: IDEOGRAM_MODEL_ID,
      model_version: IDEOGRAM_MODEL_VERSION,
      capabilities: ['text_to_image'],
      cost_per_unit_usd_cents: IDEOGRAM_COST_PER_IMAGE_CENTS,
      env_key: 'IDEOGRAM_API_KEY',
      default_base_url: 'https://api.ideogram.ai',
      format: 'image',
      response_schema: IdeogramResponseSchema,
      estimateCost: () => IDEOGRAM_COST_PER_IMAGE_CENTS,
      buildRequest: ({ apiKey, baseUrl, brandedPrompt, negativePrompt, input }) => ({
        url: `${baseUrl}/v1/ideogram-v3/generate`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Api-Key': apiKey,
        },
        body: JSON.stringify({
          prompt: brandedPrompt,
          negative_prompt: negativePrompt,
          aspect_ratio: input.aspect_ratio,
          magic_prompt: false,
        }),
      }),
      extractBytes: ({ parsed, brandedPrompt, seed }) => {
        const url = parsed.data?.[0]?.url ?? 'no-url';
        return Buffer.from(
          `ideogram:${url}:${brandedPrompt}:${seed}`,
          'utf-8',
        );
      },
    },
    config,
  );
}

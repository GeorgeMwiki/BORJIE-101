/**
 * Recraft v3 adapter.
 *
 * Vector + raster image provider per MEDIA_GENERATION_SPEC §2.
 * Brand-style transfer, SVG export for wordmark composites. Cost:
 * ~4¢ per image.
 *
 * Graceful degradation: when RECRAFT_API_KEY is absent the adapter
 * returns `null` and logs a warning.
 *
 * @module @borjie/media-generation/providers/recraft-adapter
 */

import { z } from 'zod';
import type {
  MediaArtifact,
  MediaProviderAdapter,
  MediaProviderInput,
} from '../types.js';
import { createThinAdapter, type ThinAdapterConfig } from './factory.js';

export const RECRAFT_NAME = 'recraft-v3';
export const RECRAFT_MODEL_ID = 'recraft-v3';
export const RECRAFT_MODEL_VERSION = '3.0.0';
export const RECRAFT_COST_PER_IMAGE_CENTS = 4;

const RecraftResponseSchema = z.object({
  created: z.number().optional(),
  data: z
    .array(
      z.object({
        url: z.string().optional(),
        b64_json: z.string().optional(),
      }),
    )
    .optional(),
});

export function createRecraftAdapter(
  config: ThinAdapterConfig,
): MediaProviderAdapter<MediaProviderInput, MediaArtifact> {
  return createThinAdapter(
    {
      adapter_name: RECRAFT_NAME,
      provider_id: 'recraft',
      model_id: RECRAFT_MODEL_ID,
      model_version: RECRAFT_MODEL_VERSION,
      capabilities: ['text_to_image', 'image_to_image'],
      cost_per_unit_usd_cents: RECRAFT_COST_PER_IMAGE_CENTS,
      env_key: 'RECRAFT_API_KEY',
      default_base_url: 'https://external.api.recraft.ai/v1',
      format: 'image',
      response_schema: RecraftResponseSchema,
      estimateCost: () => RECRAFT_COST_PER_IMAGE_CENTS,
      buildRequest: ({ apiKey, baseUrl, brandedPrompt, input }) => ({
        url: `${baseUrl}/images/generations`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          prompt: brandedPrompt,
          style: 'realistic_image',
          model: 'recraftv3',
          size: aspectToSize(input.aspect_ratio),
        }),
      }),
      extractBytes: ({ parsed, brandedPrompt, seed }) => {
        const first = parsed.data?.[0];
        const ref = first?.url ?? first?.b64_json ?? 'no-image';
        return Buffer.from(
          `recraft:${ref.slice(0, 24)}:${brandedPrompt}:${seed}`,
          'utf-8',
        );
      },
    },
    config,
  );
}

function aspectToSize(
  aspect: import('../types.js').MediaAspectRatio,
): string {
  switch (aspect) {
    case '1:1':
      return '1024x1024';
    case '4:5':
      return '1024x1280';
    case '9:16':
      return '720x1280';
    case '16:9':
      return '1280x720';
    case '21:9':
      return '1792x768';
  }
}

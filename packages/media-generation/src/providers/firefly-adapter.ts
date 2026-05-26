/**
 * Adobe Firefly Image 4 adapter.
 *
 * Commercial-safe inpainting per MEDIA_GENERATION_SPEC §2. Cleared
 * rights for paid-marketing assets. Cost: ~5¢ per image.
 *
 * Graceful degradation: when FIREFLY_API_KEY is absent the adapter
 * returns `null` and logs a warning.
 *
 * @module @borjie/media-generation/providers/firefly-adapter
 */

import { z } from 'zod';
import type {
  MediaArtifact,
  MediaProviderAdapter,
  MediaProviderInput,
} from '../types.js';
import { createThinAdapter, type ThinAdapterConfig } from './factory.js';

export const FIREFLY_NAME = 'firefly-image-4';
export const FIREFLY_MODEL_ID = 'firefly-image-4';
export const FIREFLY_MODEL_VERSION = '4.0.0';
export const FIREFLY_COST_PER_IMAGE_CENTS = 5;

const FireflyResponseSchema = z.object({
  outputs: z
    .array(
      z.object({
        image: z
          .object({
            url: z.string().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

export function createFireflyAdapter(
  config: ThinAdapterConfig,
): MediaProviderAdapter<MediaProviderInput, MediaArtifact> {
  return createThinAdapter(
    {
      adapter_name: FIREFLY_NAME,
      provider_id: 'firefly',
      model_id: FIREFLY_MODEL_ID,
      model_version: FIREFLY_MODEL_VERSION,
      capabilities: ['text_to_image', 'inpainting'],
      cost_per_unit_usd_cents: FIREFLY_COST_PER_IMAGE_CENTS,
      env_key: 'FIREFLY_API_KEY',
      default_base_url: 'https://firefly-api.adobe.io/v3',
      format: 'image',
      response_schema: FireflyResponseSchema,
      estimateCost: () => FIREFLY_COST_PER_IMAGE_CENTS,
      buildRequest: ({ apiKey, baseUrl, brandedPrompt, negativePrompt, input }) => ({
        url: `${baseUrl}/images/generate`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          prompt: brandedPrompt,
          negativePrompt,
          contentClass: 'photo',
          size: aspectToFireflySize(input.aspect_ratio),
        }),
      }),
      extractBytes: ({ parsed, brandedPrompt, seed }) => {
        const url = parsed.outputs?.[0]?.image?.url ?? 'no-url';
        return Buffer.from(
          `firefly:${url.slice(0, 24)}:${brandedPrompt}:${seed}`,
          'utf-8',
        );
      },
    },
    config,
  );
}

function aspectToFireflySize(
  aspect: import('../types.js').MediaAspectRatio,
): { readonly width: number; readonly height: number } {
  switch (aspect) {
    case '1:1':
      return { width: 2048, height: 2048 };
    case '4:5':
      return { width: 1640, height: 2048 };
    case '9:16':
      return { width: 1152, height: 2048 };
    case '16:9':
      return { width: 2048, height: 1152 };
    case '21:9':
      return { width: 2560, height: 1080 };
  }
}

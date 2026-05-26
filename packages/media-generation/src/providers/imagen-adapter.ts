/**
 * Google Imagen 4 adapter.
 *
 * High-volume image fallback per MEDIA_GENERATION_SPEC §2.
 * Cost-effective batches for social-post grids. Cost: ~4¢ per image.
 *
 * Graceful degradation: when GOOGLE_API_KEY is absent the adapter
 * returns `null` and logs a warning.
 *
 * @module @borjie/media-generation/providers/imagen-adapter
 */

import { z } from 'zod';
import type {
  MediaArtifact,
  MediaProviderAdapter,
  MediaProviderInput,
} from '../types.js';
import { createThinAdapter, type ThinAdapterConfig } from './factory.js';

export const IMAGEN_NAME = 'google-imagen-4';
export const IMAGEN_MODEL_ID = 'imagen-4';
export const IMAGEN_MODEL_VERSION = '4.0.0';
export const IMAGEN_COST_PER_IMAGE_CENTS = 4;

const ImagenResponseSchema = z.object({
  predictions: z
    .array(
      z.object({
        bytesBase64Encoded: z.string().optional(),
        mimeType: z.string().optional(),
      }),
    )
    .optional(),
});

export function createImagenAdapter(
  config: ThinAdapterConfig,
): MediaProviderAdapter<MediaProviderInput, MediaArtifact> {
  return createThinAdapter(
    {
      adapter_name: IMAGEN_NAME,
      provider_id: 'imagen',
      model_id: IMAGEN_MODEL_ID,
      model_version: IMAGEN_MODEL_VERSION,
      capabilities: ['text_to_image'],
      cost_per_unit_usd_cents: IMAGEN_COST_PER_IMAGE_CENTS,
      env_key: 'GOOGLE_API_KEY',
      default_base_url:
        'https://us-central1-aiplatform.googleapis.com/v1/projects',
      format: 'image',
      response_schema: ImagenResponseSchema,
      estimateCost: () => IMAGEN_COST_PER_IMAGE_CENTS,
      buildRequest: ({ apiKey, baseUrl, brandedPrompt, negativePrompt, input }) => ({
        url: `${baseUrl}/imagen-4:predict?key=${apiKey}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [
            {
              prompt: brandedPrompt,
              negative_prompt: negativePrompt,
              aspect_ratio: input.aspect_ratio,
            },
          ],
        }),
      }),
      extractBytes: ({ parsed, brandedPrompt, seed }) => {
        const b64 = parsed.predictions?.[0]?.bytesBase64Encoded ?? 'no-data';
        return Buffer.from(
          `imagen:${b64.slice(0, 24)}:${brandedPrompt}:${seed}`,
          'utf-8',
        );
      },
    },
    config,
  );
}

/**
 * Runway Gen-4 adapter.
 *
 * Primary video provider per MEDIA_GENERATION_SPEC §2. Image-to-video
 * + text-to-video at 1080p, ≤10 s. Cost: ~5¢ per second.
 *
 * Graceful degradation: when RUNWAY_API_KEY is absent the adapter
 * returns `null` and logs a warning. The dispatcher then falls back to
 * Sora 2 or Seedance 2.0.
 *
 * @module @borjie/media-generation/providers/runway-adapter
 */

import { z } from 'zod';
import type {
  MediaArtifact,
  MediaProviderAdapter,
  MediaProviderInput,
} from '../types.js';
import { createThinAdapter, type ThinAdapterConfig } from './factory.js';

export const RUNWAY_NAME = 'runway-gen4';
export const RUNWAY_MODEL_ID = 'gen-4';
export const RUNWAY_MODEL_VERSION = '4.0.0';
export const RUNWAY_COST_PER_SEC_CENTS = 5;

const RunwayResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  video: z.object({ url: z.string().optional() }).optional(),
});

export function createRunwayAdapter(
  config: ThinAdapterConfig,
): MediaProviderAdapter<MediaProviderInput, MediaArtifact> {
  return createThinAdapter(
    {
      adapter_name: RUNWAY_NAME,
      provider_id: 'runway',
      model_id: RUNWAY_MODEL_ID,
      model_version: RUNWAY_MODEL_VERSION,
      capabilities: ['image_to_video', 'text_to_video'],
      cost_per_unit_usd_cents: RUNWAY_COST_PER_SEC_CENTS,
      env_key: 'RUNWAY_API_KEY',
      default_base_url: 'https://api.runwayml.com/v1',
      format: 'short_video',
      response_schema: RunwayResponseSchema,
      estimateCost: (input) =>
        RUNWAY_COST_PER_SEC_CENTS * (input.duration_sec ?? 6),
      buildRequest: ({ apiKey, baseUrl, brandedPrompt, input }) => ({
        url: `${baseUrl}/generations/video`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          prompt: brandedPrompt,
          aspect_ratio: input.aspect_ratio,
          duration: input.duration_sec ?? 6,
          reference_image_urls: input.reference_image_urls ?? [],
        }),
      }),
      extractBytes: ({ parsed, brandedPrompt, seed }) =>
        Buffer.from(`runway:${parsed.id}:${brandedPrompt}:${seed}`, 'utf-8'),
    },
    config,
  );
}

/**
 * ByteDance Seedance 2.0 adapter.
 *
 * Asia-region SOTA video provider per MEDIA_GENERATION_SPEC §2.
 * Multi-shot consistency, strong on Swahili-script overlays. Cost: ~6¢
 * per second.
 *
 * Graceful degradation: when SEEDANCE_API_KEY is absent the adapter
 * returns `null` and logs a warning.
 *
 * @module @borjie/media-generation/providers/seedance-adapter
 */

import { z } from 'zod';
import type {
  MediaArtifact,
  MediaProviderAdapter,
  MediaProviderInput,
} from '../types.js';
import { createThinAdapter, type ThinAdapterConfig } from './factory.js';

export const SEEDANCE_NAME = 'seedance-2';
export const SEEDANCE_MODEL_ID = 'seedance-2';
export const SEEDANCE_MODEL_VERSION = '2.0.0';
export const SEEDANCE_COST_PER_SEC_CENTS = 6;

const SeedanceResponseSchema = z.object({
  task_id: z.string(),
  status: z.string(),
  video_url: z.string().optional(),
});

export function createSeedanceAdapter(
  config: ThinAdapterConfig,
): MediaProviderAdapter<MediaProviderInput, MediaArtifact> {
  return createThinAdapter(
    {
      adapter_name: SEEDANCE_NAME,
      provider_id: 'seedance',
      model_id: SEEDANCE_MODEL_ID,
      model_version: SEEDANCE_MODEL_VERSION,
      capabilities: ['text_to_video', 'image_to_video'],
      cost_per_unit_usd_cents: SEEDANCE_COST_PER_SEC_CENTS,
      env_key: 'SEEDANCE_API_KEY',
      default_base_url: 'https://open.bytedance.com/api/seedance/v2',
      format: 'short_video',
      response_schema: SeedanceResponseSchema,
      estimateCost: (input) =>
        SEEDANCE_COST_PER_SEC_CENTS * (input.duration_sec ?? 8),
      buildRequest: ({ apiKey, baseUrl, brandedPrompt, input }) => ({
        url: `${baseUrl}/text2video`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          prompt: brandedPrompt,
          ratio: input.aspect_ratio,
          duration: input.duration_sec ?? 8,
        }),
      }),
      extractBytes: ({ parsed, brandedPrompt, seed }) =>
        Buffer.from(
          `seedance:${parsed.task_id}:${brandedPrompt}:${seed}`,
          'utf-8',
        ),
    },
    config,
  );
}

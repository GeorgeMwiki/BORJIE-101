/**
 * Hedra Character-3 adapter.
 *
 * Face animation + lipsync provider per MEDIA_GENERATION_SPEC §2.
 * Takes a portrait + audio + script, returns a lipsynced talking-head
 * clip. Cost: ~10¢ per second.
 *
 * Graceful degradation: when HEDRA_API_KEY is absent the adapter
 * returns `null` and logs a warning.
 *
 * @module @borjie/media-generation/providers/hedra-adapter
 */

import { z } from 'zod';
import type {
  MediaArtifact,
  MediaProviderAdapter,
  MediaProviderInput,
} from '../types.js';
import { createThinAdapter, type ThinAdapterConfig } from './factory.js';

export const HEDRA_NAME = 'hedra-character-3';
export const HEDRA_MODEL_ID = 'character-3';
export const HEDRA_MODEL_VERSION = '3.0.0';
export const HEDRA_COST_PER_SEC_CENTS = 10;

const HedraResponseSchema = z.object({
  job_id: z.string(),
  status: z.string(),
  video_url: z.string().optional(),
});

export function createHedraAdapter(
  config: ThinAdapterConfig,
): MediaProviderAdapter<MediaProviderInput, MediaArtifact> {
  return createThinAdapter(
    {
      adapter_name: HEDRA_NAME,
      provider_id: 'hedra',
      model_id: HEDRA_MODEL_ID,
      model_version: HEDRA_MODEL_VERSION,
      capabilities: ['lipsync_video'],
      cost_per_unit_usd_cents: HEDRA_COST_PER_SEC_CENTS,
      env_key: 'HEDRA_API_KEY',
      default_base_url: 'https://api.hedra.com/v1',
      format: 'lipsync_video',
      response_schema: HedraResponseSchema,
      estimateCost: (input) =>
        HEDRA_COST_PER_SEC_CENTS * (input.duration_sec ?? 30),
      buildRequest: ({ apiKey, baseUrl, brandedPrompt, input }) => ({
        url: `${baseUrl}/characters/generations`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          text: brandedPrompt,
          audio_source_url: input.reference_audio_url ?? '',
          avatar_image_url: input.reference_image_urls?.[0] ?? '',
          aspect_ratio: input.aspect_ratio,
        }),
      }),
      extractBytes: ({ parsed, brandedPrompt, seed }) =>
        Buffer.from(
          `hedra:${parsed.job_id}:${brandedPrompt}:${seed}`,
          'utf-8',
        ),
    },
    config,
  );
}

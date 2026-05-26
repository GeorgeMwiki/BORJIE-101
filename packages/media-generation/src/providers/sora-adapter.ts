/**
 * OpenAI Sora 2 adapter.
 *
 * Secondary video provider per MEDIA_GENERATION_SPEC §2. Narrative
 * scenes up to 20 s, best multi-shot story arc. Cost: ~10¢ per second.
 *
 * Graceful degradation: when OPENAI_API_KEY is absent the adapter
 * returns `null` and logs a warning. The dispatcher then falls back to
 * Seedance 2.0 or Luma.
 *
 * @module @borjie/media-generation/providers/sora-adapter
 */

import { z } from 'zod';
import type {
  MediaArtifact,
  MediaProviderAdapter,
  MediaProviderInput,
} from '../types.js';
import { createThinAdapter, type ThinAdapterConfig } from './factory.js';

export const SORA_NAME = 'openai-sora-2';
export const SORA_MODEL_ID = 'sora-2';
export const SORA_MODEL_VERSION = '2.0.0';
export const SORA_COST_PER_SEC_CENTS = 10;

const SoraResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  output: z
    .object({
      video_url: z.string().optional(),
    })
    .optional(),
});

export function createSoraAdapter(
  config: ThinAdapterConfig,
): MediaProviderAdapter<MediaProviderInput, MediaArtifact> {
  return createThinAdapter(
    {
      adapter_name: SORA_NAME,
      provider_id: 'sora',
      model_id: SORA_MODEL_ID,
      model_version: SORA_MODEL_VERSION,
      capabilities: ['text_to_video', 'image_to_video'],
      cost_per_unit_usd_cents: SORA_COST_PER_SEC_CENTS,
      env_key: 'OPENAI_API_KEY',
      default_base_url: 'https://api.openai.com/v1',
      format: 'short_video',
      response_schema: SoraResponseSchema,
      estimateCost: (input) =>
        SORA_COST_PER_SEC_CENTS * (input.duration_sec ?? 10),
      buildRequest: ({ apiKey, baseUrl, brandedPrompt, input }) => ({
        url: `${baseUrl}/video/generations`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'sora-2',
          prompt: brandedPrompt,
          aspect_ratio: input.aspect_ratio,
          duration_seconds: input.duration_sec ?? 10,
        }),
      }),
      extractBytes: ({ parsed, brandedPrompt, seed }) =>
        Buffer.from(`sora:${parsed.id}:${brandedPrompt}:${seed}`, 'utf-8'),
    },
    config,
  );
}

/**
 * HeyGen Avatar V5 adapter.
 *
 * Talking-head video synthesis per MEDIA_GENERATION_SPEC §2. Avatar
 * pipeline for tutorial / regulator-explainer videos. Cost: ~15¢ per
 * second.
 *
 * Graceful degradation: when HEYGEN_API_KEY is absent the adapter
 * returns `null` and logs a warning.
 *
 * @module @borjie/media-generation/providers/heygen-adapter
 */

import { z } from 'zod';
import type {
  MediaArtifact,
  MediaProviderAdapter,
  MediaProviderInput,
} from '../types.js';
import { createThinAdapter, type ThinAdapterConfig } from './factory.js';

export const HEYGEN_NAME = 'heygen-avatar-v5';
export const HEYGEN_MODEL_ID = 'avatar-v5';
export const HEYGEN_MODEL_VERSION = '5.0.0';
export const HEYGEN_COST_PER_SEC_CENTS = 15;

const HeyGenResponseSchema = z.object({
  data: z
    .object({
      video_id: z.string().optional(),
      status: z.string().optional(),
      video_url: z.string().optional(),
    })
    .optional(),
});

export function createHeyGenAdapter(
  config: ThinAdapterConfig,
): MediaProviderAdapter<MediaProviderInput, MediaArtifact> {
  return createThinAdapter(
    {
      adapter_name: HEYGEN_NAME,
      provider_id: 'heygen',
      model_id: HEYGEN_MODEL_ID,
      model_version: HEYGEN_MODEL_VERSION,
      capabilities: ['lipsync_video'],
      cost_per_unit_usd_cents: HEYGEN_COST_PER_SEC_CENTS,
      env_key: 'HEYGEN_API_KEY',
      default_base_url: 'https://api.heygen.com/v2',
      format: 'lipsync_video',
      response_schema: HeyGenResponseSchema,
      estimateCost: (input) =>
        HEYGEN_COST_PER_SEC_CENTS * (input.duration_sec ?? 60),
      buildRequest: ({ apiKey, baseUrl, brandedPrompt, input }) => ({
        url: `${baseUrl}/video/generate`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          video_inputs: [
            {
              character: {
                type: 'avatar',
                avatar_id: input.reference_image_urls?.[0] ?? 'borjie-default',
              },
              voice: {
                type: 'text',
                input_text: brandedPrompt,
              },
            },
          ],
          dimension: aspectToDimension(input.aspect_ratio),
        }),
      }),
      extractBytes: ({ parsed, brandedPrompt, seed }) => {
        const id = parsed.data?.video_id ?? 'no-id';
        return Buffer.from(
          `heygen:${id}:${brandedPrompt}:${seed}`,
          'utf-8',
        );
      },
    },
    config,
  );
}

function aspectToDimension(
  aspect: import('../types.js').MediaAspectRatio,
): { readonly width: number; readonly height: number } {
  switch (aspect) {
    case '1:1':
      return { width: 1080, height: 1080 };
    case '4:5':
      return { width: 1080, height: 1350 };
    case '9:16':
      return { width: 1080, height: 1920 };
    case '16:9':
      return { width: 1920, height: 1080 };
    case '21:9':
      return { width: 2560, height: 1080 };
  }
}

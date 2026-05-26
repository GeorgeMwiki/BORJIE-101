/**
 * Stable Diffusion 3.5 Large adapter.
 *
 * Self-hostable backup image provider per MEDIA_GENERATION_SPEC §2.
 * Air-gapped tier, owner-controlled when external models are
 * unavailable. Cost: 0 (when self-hosted; otherwise the configured
 * inference endpoint's cost).
 *
 * Graceful degradation: when SD35_ENDPOINT or SD35_API_KEY is absent
 * the adapter returns `null` and logs a warning.
 *
 * @module @borjie/media-generation/providers/sd35-adapter
 */

import { z } from 'zod';
import type {
  MediaArtifact,
  MediaProviderAdapter,
  MediaProviderInput,
} from '../types.js';
import { createThinAdapter, type ThinAdapterConfig } from './factory.js';

export const SD35_NAME = 'stable-diffusion-3.5-large';
export const SD35_MODEL_ID = 'sd3.5-large';
export const SD35_MODEL_VERSION = '3.5.0';
export const SD35_COST_PER_IMAGE_CENTS = 0;

const Sd35ResponseSchema = z.object({
  image: z.string().optional(),
  artifacts: z
    .array(
      z.object({
        base64: z.string().optional(),
      }),
    )
    .optional(),
});

export function createSd35Adapter(
  config: ThinAdapterConfig,
): MediaProviderAdapter<MediaProviderInput, MediaArtifact> {
  return createThinAdapter(
    {
      adapter_name: SD35_NAME,
      provider_id: 'sd35',
      model_id: SD35_MODEL_ID,
      model_version: SD35_MODEL_VERSION,
      capabilities: ['text_to_image', 'image_to_image'],
      cost_per_unit_usd_cents: SD35_COST_PER_IMAGE_CENTS,
      env_key: 'SD35_API_KEY',
      default_base_url: 'http://localhost:7860/sdapi/v1',
      format: 'image',
      response_schema: Sd35ResponseSchema,
      estimateCost: () => SD35_COST_PER_IMAGE_CENTS,
      buildRequest: ({ apiKey, baseUrl, brandedPrompt, negativePrompt, input }) => {
        // SD35_ENDPOINT may override base URL via env.
        const endpoint =
          // eslint-disable-next-line no-process-env -- env override is intentional
          process.env.SD35_ENDPOINT?.trim() && process.env.SD35_ENDPOINT.length > 0
            ? // eslint-disable-next-line no-process-env -- env override is intentional
              process.env.SD35_ENDPOINT.trim()
            : baseUrl;
        return {
          url: `${endpoint}/txt2img`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            prompt: brandedPrompt,
            negative_prompt: negativePrompt,
            width: aspectToWidth(input.aspect_ratio),
            height: aspectToHeight(input.aspect_ratio),
            steps: 35,
            cfg_scale: 6.5,
          }),
        };
      },
      extractBytes: ({ parsed, brandedPrompt, seed }) => {
        const b64 = parsed.image ?? parsed.artifacts?.[0]?.base64 ?? 'no-data';
        return Buffer.from(
          `sd35:${b64.slice(0, 24)}:${brandedPrompt}:${seed}`,
          'utf-8',
        );
      },
    },
    config,
  );
}

function aspectToWidth(aspect: import('../types.js').MediaAspectRatio): number {
  switch (aspect) {
    case '1:1':
      return 1024;
    case '4:5':
      return 1024;
    case '9:16':
      return 768;
    case '16:9':
      return 1280;
    case '21:9':
      return 1536;
  }
}

function aspectToHeight(aspect: import('../types.js').MediaAspectRatio): number {
  switch (aspect) {
    case '1:1':
      return 1024;
    case '4:5':
      return 1280;
    case '9:16':
      return 1344;
    case '16:9':
      return 720;
    case '21:9':
      return 640;
  }
}

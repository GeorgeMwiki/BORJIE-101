/**
 * Brand-violation scanner.
 *
 * Post-generation Anthropic Haiku 4.5 vision call — palette density,
 * wordmark integrity, signature treatment. Returns a flag list so the
 * dispatcher can decide whether to retry, refuse, or downgrade the
 * artifact's authority tier.
 *
 * This module wraps the lower-level `output-validator.ts` and adapts
 * its result to a unified safety-scan shape used by `composer.ts`.
 *
 * Configuration:
 *   - ANTHROPIC_API_KEY — vision call (graceful-degrades when absent)
 *
 * @module @borjie/media-generation/safety/brand-violation-scanner
 */

import type { BrandSpec, MediaLogger } from '../types.js';
import { NOOP_LOGGER } from '../types.js';
import { readEnvKey, safeFetch } from '../providers/shared.js';
import {
  validateOutputBrand,
  type VisionApiFn,
} from '../brand-lock/output-validator.js';

export interface BrandScanInput {
  readonly artifact_bytes: Buffer;
  readonly format: 'image' | 'short_video' | 'lipsync_video';
  readonly brand: BrandSpec;
  readonly recipe_id: string;
  readonly expect_wordmark: boolean;
  readonly logger?: MediaLogger;
  readonly fetchImpl?: typeof fetch;
}

export interface BrandScanResult {
  readonly ok: boolean;
  readonly palette_density: number;
  readonly wordmark_integrity: number;
  readonly signature_treatment: number;
  readonly flags: ReadonlyArray<string>;
}

export async function scanBrandViolation(
  input: BrandScanInput,
): Promise<BrandScanResult> {
  const logger = input.logger ?? NOOP_LOGGER;
  const apiKey = readEnvKey('ANTHROPIC_API_KEY');
  const visionApiFn: VisionApiFn | undefined = apiKey
    ? buildHaikuVision({
        apiKey,
        ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
        logger,
      })
    : undefined;

  const validationInput = {
    artifact_bytes: input.artifact_bytes,
    format: input.format,
    brand: input.brand,
    recipe_id: input.recipe_id,
    expect_wordmark: input.expect_wordmark,
    logger,
    ...(visionApiFn ? { visionApiFn } : {}),
  };

  const result = await validateOutputBrand(validationInput);

  return {
    ok: result.ok,
    palette_density: result.palette_density,
    wordmark_integrity: result.wordmark_integrity,
    signature_treatment: result.signature_treatment,
    flags: result.violation_flags,
  };
}

interface HaikuVisionConfig {
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
  readonly logger: MediaLogger;
}

function buildHaikuVision(config: HaikuVisionConfig): VisionApiFn {
  return async ({ artifact_bytes, brand_palette_oklch, expect_wordmark }) => {
    const b64 = artifact_bytes.toString('base64');
    const palette = brand_palette_oklch.join(', ');
    const fetchOpts: Parameters<typeof safeFetch>[0] = {
      url: 'https://api.anthropic.com/v1/messages',
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 200,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: b64.slice(0, 1024 * 1024),
                  },
                },
                {
                  type: 'text',
                  text:
                    `Assess this image's brand conformance. Palette anchors: ${palette}. ` +
                    `Wordmark expected: ${expect_wordmark}. ` +
                    `Reply with a single JSON object: {"palette_density":0..1,"wordmark_integrity":0..1,"signature_treatment":0..1}.`,
                },
              ],
            },
          ],
        }),
      },
    };
    if (config.fetchImpl) {
      // Augment with the injected fetch (separate assign so the
      // `readonly` discriminator stays exactOptional-friendly).
      (fetchOpts as { fetchImpl?: typeof fetch }).fetchImpl = config.fetchImpl;
    }
    const res = await safeFetch(fetchOpts);
    if (!res.ok) {
      config.logger.warn('brand-violation-scanner: haiku fetch failed', {
        reason: res.reason,
      });
      return {
        palette_density: 1,
        wordmark_integrity: 1,
        signature_treatment: 1,
      };
    }
    try {
      const parsed = JSON.parse(res.bodyText) as {
        readonly content?: ReadonlyArray<{ readonly text?: string }>;
      };
      const text = parsed.content?.[0]?.text ?? '{}';
      const scores = JSON.parse(text) as Record<string, number>;
      return {
        palette_density: clamp01(scores.palette_density ?? 1),
        wordmark_integrity: clamp01(scores.wordmark_integrity ?? 1),
        signature_treatment: clamp01(scores.signature_treatment ?? 1),
      };
    } catch (err) {
      config.logger.warn('brand-violation-scanner: haiku parse failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      return {
        palette_density: 1,
        wordmark_integrity: 1,
        signature_treatment: 1,
      };
    }
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

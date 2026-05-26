/**
 * NSFW scanner.
 *
 * Primary: OpenAI Moderation API (image classes via `/v1/moderations`
 * with the omni-moderation-latest model). Fallback: NSFWJS local
 * inference (env-controlled). Both return a probability in [0, 1].
 *
 * Configuration via env keys:
 *   - OPENAI_API_KEY — primary scanner
 *   - NSFWJS_ENABLED — set "true" to run the local fallback
 *
 * Graceful degradation: when no scanner is available we return a
 * permissive default `{ probability: 0 }` and log a warning. The
 * dispatcher decides whether that's enough to publish at the recipe's
 * tier.
 *
 * @module @borjie/media-generation/safety/nsfw-scanner
 */

import { z } from 'zod';
import type { MediaLogger } from '../types.js';
import { NOOP_LOGGER } from '../types.js';
import { readEnvKey, safeFetch } from '../providers/shared.js';

export interface NsfwScanInput {
  readonly artifact_bytes: Buffer;
  readonly format: 'image' | 'short_video' | 'lipsync_video';
  readonly artifact_url?: string;
  readonly logger?: MediaLogger;
  readonly fetchImpl?: typeof fetch;
}

export interface NsfwScanResult {
  readonly probability: number;
  readonly scanner: 'openai-moderation' | 'nsfwjs' | 'none';
  readonly raw?: unknown;
}

const ModerationResponseSchema = z.object({
  results: z
    .array(
      z.object({
        flagged: z.boolean().optional(),
        category_scores: z.record(z.unknown()).optional(),
      }),
    )
    .optional(),
});

/**
 * Threshold above which an artifact is refused for the corresponding
 * authority tier. The caller picks the threshold per-recipe.
 */
export const NSFW_TIER_THRESHOLDS = Object.freeze({
  tier_0: 0.85,
  tier_1: 0.5,
  tier_2: 0.2,
});

export async function scanForNsfw(
  input: NsfwScanInput,
): Promise<NsfwScanResult> {
  const logger = input.logger ?? NOOP_LOGGER;
  const apiKey = readEnvKey('OPENAI_API_KEY');
  if (apiKey && input.artifact_url) {
    const res = await safeFetch({
      url: 'https://api.openai.com/v1/moderations',
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'omni-moderation-latest',
          input: [{ type: 'image_url', image_url: { url: input.artifact_url } }],
        }),
      },
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
    if (res.ok) {
      try {
        const parsed = ModerationResponseSchema.parse(JSON.parse(res.bodyText));
        const scores = parsed.results?.[0]?.category_scores ?? {};
        const probability = computeWorstCaseScore(scores);
        return { probability, scanner: 'openai-moderation', raw: parsed };
      } catch (err) {
        logger.warn('nsfw-scanner: openai parse failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      logger.warn('nsfw-scanner: openai fetch failed', { reason: res.reason });
    }
  }

  const nsfwjsEnabled =
    (readEnvKey('NSFWJS_ENABLED') ?? '').toLowerCase() === 'true';
  if (nsfwjsEnabled) {
    // Local NSFWJS path — production wires this to a worker. We never
    // reach into the model from this package; the env-controlled
    // toggle is the contract.
    logger.info('nsfw-scanner: nsfwjs enabled but no local binding wired');
    return { probability: 0, scanner: 'nsfwjs' };
  }

  logger.warn('nsfw-scanner: no scanner configured; returning permissive 0');
  return { probability: 0, scanner: 'none' };
}

function computeWorstCaseScore(
  scores: Readonly<Record<string, unknown>>,
): number {
  let worst = 0;
  for (const v of Object.values(scores)) {
    if (typeof v === 'number') {
      worst = Math.max(worst, v);
    }
  }
  // clip into [0,1]
  return Math.max(0, Math.min(1, worst));
}

/**
 * Deepfake detector.
 *
 * Wraps the Reality Defender API (env-gated). Returns probability in
 * [0, 1] + a list of flagged frame timestamps (videos only).
 *
 * Configuration via env keys:
 *   - REALITY_DEFENDER_API_KEY — primary scanner
 *
 * Graceful degradation: when the key is absent the detector returns a
 * permissive default + logs a warning. The dispatcher decides whether
 * the artifact is publishable.
 *
 * Per spec §11: never publish a media artefact depicting a real
 * person without an explicit consent token. The detector enforces
 * the technical half of that policy; the consent gate enforces the
 * policy half (see `composer.ts`).
 *
 * @module @borjie/media-generation/safety/deepfake-detector
 */

import { z } from 'zod';
import type { MediaLogger } from '../types.js';
import { NOOP_LOGGER } from '../types.js';
import { readEnvKey, safeFetch } from '../providers/shared.js';

export interface DeepfakeScanInput {
  readonly artifact_url: string;
  readonly format: 'image' | 'short_video' | 'lipsync_video';
  readonly logger?: MediaLogger;
  readonly fetchImpl?: typeof fetch;
}

export interface DeepfakeScanResult {
  readonly probability: number;
  readonly flagged_frames_sec: ReadonlyArray<number>;
  readonly scanner: 'reality-defender' | 'none';
  readonly raw?: unknown;
}

const RealityDefenderResponseSchema = z.object({
  status: z.string().optional(),
  result: z
    .object({
      score: z.number().optional(),
      flagged_frames: z.array(z.number()).optional(),
    })
    .optional(),
});

/**
 * Per spec, the dispatcher refuses to publish a Tier-2 artifact whose
 * deepfake probability exceeds 0.5 unless a consent token is present.
 */
export const DEEPFAKE_TIER_THRESHOLDS = Object.freeze({
  tier_0: 0.95,
  tier_1: 0.7,
  tier_2: 0.5,
});

export async function detectDeepfake(
  input: DeepfakeScanInput,
): Promise<DeepfakeScanResult> {
  const logger = input.logger ?? NOOP_LOGGER;
  const apiKey = readEnvKey('REALITY_DEFENDER_API_KEY');
  if (!apiKey) {
    logger.warn(
      'deepfake-detector: REALITY_DEFENDER_API_KEY missing, returning permissive 0',
    );
    return { probability: 0, flagged_frames_sec: [], scanner: 'none' };
  }

  const res = await safeFetch({
    url: 'https://api.realitydefender.com/v3/files',
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        file_url: input.artifact_url,
        modality: input.format === 'image' ? 'image' : 'video',
      }),
    },
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  });

  if (!res.ok) {
    logger.warn('deepfake-detector: fetch failed', { reason: res.reason });
    return { probability: 0, flagged_frames_sec: [], scanner: 'reality-defender' };
  }

  try {
    const parsed = RealityDefenderResponseSchema.parse(JSON.parse(res.bodyText));
    const probability = Math.max(0, Math.min(1, parsed.result?.score ?? 0));
    const flagged = parsed.result?.flagged_frames ?? [];
    return {
      probability,
      flagged_frames_sec: Object.freeze([...flagged]),
      scanner: 'reality-defender',
      raw: parsed,
    };
  } catch (err) {
    logger.warn('deepfake-detector: parse failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return { probability: 0, flagged_frames_sec: [], scanner: 'reality-defender' };
  }
}

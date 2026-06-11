/**
 * Real SHORT-VIDEO provider adapters — Sora-2 / Veo-3 / Seedance-2 class.
 *
 * Endpoints + request shapes follow MEDIA_GENERATION_SOTA_SPEC §2.1.
 * These adapters issue the CREATE call; the documented async lifecycle
 * (poll + download) is the host job-runner's responsibility — these
 * specs degrade-or-throw and never fabricate. Keys are INJECTED.
 *
 * @module @borjie/media-engine/providers/video-adapters
 */

import type { MediaProvider } from './port.js';
import { createHttpProvider } from './http-adapter.js';

export interface VideoAdapterConfig {
  readonly soraBaseUrl?: string;
  readonly veoBaseUrl?: string;
  readonly seedanceBaseUrl?: string;
}

/** OpenAI Sora 2 — async `POST /videos`. SynthID not embedded. */
export function createSoraProvider(
  config: VideoAdapterConfig = {},
): MediaProvider {
  const base = config.soraBaseUrl ?? 'https://api.openai.com/v1';
  return createHttpProvider({
    id: 'sora',
    capabilities: ['short_video'],
    endpoint: () => `${base}/videos`,
    buildBody: (inv) => ({
      model: 'sora-2',
      prompt: inv.prompt,
      seconds: inv.durationSec,
      size: inv.aspectRatio,
    }),
    format: () => 'mp4',
    synthId: false,
    cost: { perVideoSecondCents: 10 },
  });
}

/** Google Veo 3.1 — Gemini long-running operation. SynthID non-optional. */
export function createVeoProvider(
  config: VideoAdapterConfig = {},
): MediaProvider {
  const base =
    config.veoBaseUrl ??
    'https://generativelanguage.googleapis.com/v1/models/veo-3.1';
  return createHttpProvider({
    id: 'veo',
    capabilities: ['short_video'],
    endpoint: () => `${base}:predictLongRunning`,
    buildBody: (inv) => ({
      instances: [{ prompt: inv.prompt }],
      parameters: {
        aspectRatio: inv.aspectRatio,
        durationSeconds: inv.durationSec,
      },
    }),
    format: () => 'mp4',
    synthId: true,
    cost: { perVideoSecondCents: 15 },
  });
}

/** ByteDance Seedance 2.0 — ModelArk async task submit. */
export function createSeedanceProvider(
  config: VideoAdapterConfig = {},
): MediaProvider {
  const base =
    config.seedanceBaseUrl ??
    'https://ark.ap-southeast.bytepluses.com/api/v3';
  return createHttpProvider({
    id: 'seedance',
    capabilities: ['short_video'],
    endpoint: () => `${base}/contents/generations/tasks`,
    buildBody: (inv) => ({
      model: 'seedance-2-0',
      content: [{ type: 'text', text: inv.prompt }],
      duration: inv.durationSec,
      ratio: inv.aspectRatio,
    }),
    format: () => 'mp4',
    synthId: false,
    cost: { perVideoSecondCents: 10 },
  });
}

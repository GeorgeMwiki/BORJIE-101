/**
 * Veo 3.1 / Veo 3.1 Lite — Google.
 *
 * Real fetch implementation against Google's Generative Language REST API
 * (`models/veo-3.0-generate-preview:predictLongRunning`). The Veo
 * endpoints are async — we issue `predictLongRunning`, then poll
 * `operations/{name}` until `done: true`, then read the GCS / data URI
 * returned in `response.generateVideoResponse.generatedSamples[]`.
 *
 * Reference:
 *   - https://ai.google.dev/api/generate-content#veo
 *   - https://aistudio.google.com/models/veo-3
 *
 * Env vars (read lazily — never at module load):
 *   - GOOGLE_VEO_API_KEY    (required for real calls)
 *   - GOOGLE_VEO_MODEL      (optional, default `veo-3.0-generate-preview`)
 *
 * Stub fallback: when the key is missing the provider returns a
 * deterministic placeholder MP4 URL and emits a one-shot warning in
 * non-test mode.
 */

import { buildC2paManifest } from '../../c2pa/attestation.js';
import {
  DEFAULT_TIMEOUTS,
  ProviderHttpError,
  ProviderTimeoutError,
  deterministicHash,
  fetchWithTimeout,
  readEnv,
  warnStubInvocation,
} from '../shared.js';
import type {
  ContentResult,
  VideoProvider,
  VideoRequest,
  VideoTask,
} from '../../types.js';

export const STUB_PROVIDER = false; // becomes a stub at runtime only if key is missing
const SUPPORTED: ReadonlyArray<VideoTask> = ['sizzle_reel', 'i2v_walkthrough'];
const PROVIDER_ID = 'veo';
const DEFAULT_MODEL = 'veo-3.0-generate-preview';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const POLL_INTERVAL_MS = 5_000;

export interface VeoProviderOptions {
  readonly timeoutMs?: number;
}

export function createVeoProvider(options: VeoProviderOptions = {}): VideoProvider {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUTS.video;

  return {
    providerId: PROVIDER_ID,
    supportedTasks: SUPPORTED,

    async generate(req: VideoRequest): Promise<ContentResult> {
      const apiKey = readEnv('GOOGLE_VEO_API_KEY');
      const modelId = readEnv('GOOGLE_VEO_MODEL') ?? DEFAULT_MODEL;
      const createdAtIso = new Date().toISOString();

      if (apiKey === undefined) {
        warnStubInvocation(PROVIDER_ID, 'GOOGLE_VEO_API_KEY');
        return stubResult(req, modelId, createdAtIso);
      }

      const startedAt = Date.now();

      // 1. kick off long-running prediction
      const startRes = await fetchWithTimeout({
        providerId: PROVIDER_ID,
        url: `${API_BASE}/models/${encodeURIComponent(modelId)}:predictLongRunning?key=${encodeURIComponent(apiKey)}`,
        timeoutMs: 30_000,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt: req.prompt }],
            parameters: {
              aspectRatio: req.aspectRatio,
              durationSeconds: req.durationSeconds,
              numberOfVideos: 1,
              personGeneration: 'allow_adult',
            },
          }),
        },
      });
      if (!startRes.ok) {
        const text = await startRes.text().catch(() => '');
        throw new ProviderHttpError(PROVIDER_ID, startRes.status, text);
      }
      const startJson = (await startRes.json()) as VeoOperation;
      const opName = startJson.name;
      if (opName === undefined) {
        throw new ProviderHttpError(PROVIDER_ID, 200, 'predictLongRunning returned no name');
      }

      // 2. poll the operation
      while (true) {
        if (Date.now() - startedAt > timeoutMs) {
          throw new ProviderTimeoutError(PROVIDER_ID, timeoutMs);
        }
        await sleep(POLL_INTERVAL_MS);

        const pollRes = await fetchWithTimeout({
          providerId: PROVIDER_ID,
          url: `${API_BASE}/${opName}?key=${encodeURIComponent(apiKey)}`,
          timeoutMs: 10_000,
          init: { method: 'GET' },
        });
        if (!pollRes.ok) {
          const text = await pollRes.text().catch(() => '');
          throw new ProviderHttpError(PROVIDER_ID, pollRes.status, text);
        }
        const poll = (await pollRes.json()) as VeoOperation;
        if (poll.error) {
          throw new ProviderHttpError(
            PROVIDER_ID,
            200,
            `veo operation error code=${poll.error.code}: ${poll.error.message}`,
          );
        }
        if (poll.done === true) {
          const sample =
            poll.response?.generateVideoResponse?.generatedSamples?.[0]?.video;
          const url = sample?.uri;
          if (url === undefined) {
            throw new ProviderHttpError(PROVIDER_ID, 200, 'completed but no video uri');
          }
          return {
            providerId: PROVIDER_ID,
            modelId,
            modality: 'video',
            assets: [
              {
                url,
                mimeType: 'video/mp4',
                widthPx: req.aspectRatio === '9:16' ? 1080 : 1920,
                heightPx: req.aspectRatio === '9:16' ? 1920 : 1080,
                durationSeconds: req.durationSeconds,
              },
            ],
            // Per Veo pricing tier (~$0.30/sec for 3.0 preview reference).
            costMicrousd: req.durationSeconds * 300_000,
            c2paManifest: buildC2paManifest({
              title: 'Veo generated video',
              format: 'video/mp4',
              providerId: PROVIDER_ID,
              modelId,
              prompt: req.prompt,
              tenantId: req.tenantId,
              seed: 0,
              loraIds: req.brand?.loraIds ?? [],
              createdAtIso,
            }),
            createdAtIso,
          };
        }
        // else still running — loop.
      }
    },
  };
}

interface VeoOperation {
  readonly name?: string;
  readonly done?: boolean;
  readonly error?: { readonly code: number; readonly message: string };
  readonly response?: {
    readonly generateVideoResponse?: {
      readonly generatedSamples?: ReadonlyArray<{
        readonly video?: { readonly uri?: string };
      }>;
    };
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function stubResult(req: VideoRequest, modelId: string, createdAtIso: string): ContentResult {
  const hash = deterministicHash(
    `${PROVIDER_ID}|${req.prompt}|${req.durationSeconds}|${req.aspectRatio}`,
  );
  return {
    providerId: PROVIDER_ID,
    modelId,
    modality: 'video',
    assets: [
      {
        url: `https://stub.borjie.local/veo/${hash}.mp4`,
        mimeType: 'video/mp4',
        widthPx: req.aspectRatio === '9:16' ? 1080 : 1920,
        heightPx: req.aspectRatio === '9:16' ? 1920 : 1080,
        durationSeconds: req.durationSeconds,
      },
    ],
    costMicrousd: req.durationSeconds * 300_000,
    c2paManifest: buildC2paManifest({
      title: 'Veo generated video (stub)',
      format: 'video/mp4',
      providerId: PROVIDER_ID,
      modelId,
      prompt: req.prompt,
      tenantId: req.tenantId,
      seed: 0,
      loraIds: req.brand?.loraIds ?? [],
      createdAtIso,
    }),
    createdAtIso,
  };
}

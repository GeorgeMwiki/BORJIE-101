/**
 * Meshy AI — text-to-3D (`.glb`).
 *
 * Real fetch implementation against `POST https://api.meshy.ai/v2/text-to-3d`.
 * Meshy returns a task id immediately, then resolves to a model URL via
 * the GET poll endpoint. We poll once per second up to `timeoutMs`.
 *
 * Reference:
 *   - https://docs.meshy.ai/api/text-to-3d
 *
 * Env vars (read lazily — never at module load):
 *   - MESHY_API_KEY  (required to enable real calls)
 *
 * Stub fallback: when the key is missing the provider returns a
 * deterministic placeholder `.glb` URL and emits a one-shot warning in
 * non-test mode. Surfaced under the image provider interface (no 3D task
 * yet in the taxonomy — caller wires this manually).
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
  ImageProvider,
  ImageRequest,
  ImageTask,
} from '../../types.js';

export const STUB_PROVIDER = false; // becomes a stub at runtime only if key is missing
const SUPPORTED: ReadonlyArray<ImageTask> = []; // no 3D task in image taxonomy yet
const PROVIDER_ID = 'meshy';
const MODEL_ID = 'meshy-text-to-3d-v2';
const CREATE_ENDPOINT = 'https://api.meshy.ai/v2/text-to-3d';
const POLL_INTERVAL_MS = 1000;

export interface MeshyProviderOptions {
  /** Overall budget for the create+poll loop. Default 5 min (video-grade). */
  readonly timeoutMs?: number;
}

export function createMeshyProvider(options: MeshyProviderOptions = {}): ImageProvider {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUTS.video;

  return {
    providerId: PROVIDER_ID,
    supportedTasks: SUPPORTED,

    async generate(req: ImageRequest): Promise<ContentResult> {
      const apiKey = readEnv('MESHY_API_KEY');
      const createdAtIso = new Date().toISOString();

      if (apiKey === undefined) {
        warnStubInvocation(PROVIDER_ID, 'MESHY_API_KEY');
        return stubResult(req, createdAtIso);
      }

      const startedAt = Date.now();

      // 1. kick off the task
      const createRes = await fetchWithTimeout({
        providerId: PROVIDER_ID,
        url: CREATE_ENDPOINT,
        timeoutMs,
        init: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            mode: 'preview',
            prompt: req.prompt,
            art_style: 'realistic',
            ai_model: 'meshy-4',
            negative_prompt: 'low quality, low resolution',
          }),
        },
      });
      if (!createRes.ok) {
        const text = await createRes.text().catch(() => '');
        throw new ProviderHttpError(PROVIDER_ID, createRes.status, text);
      }
      const { result: taskId } = (await createRes.json()) as { result?: string };
      if (taskId === undefined) {
        throw new ProviderHttpError(PROVIDER_ID, 200, 'task create returned no id');
      }

      // 2. poll until SUCCEEDED / FAILED / timeout
      while (true) {
        if (Date.now() - startedAt > timeoutMs) {
          throw new ProviderTimeoutError(PROVIDER_ID, timeoutMs);
        }
        await sleep(POLL_INTERVAL_MS);

        const pollRes = await fetchWithTimeout({
          providerId: PROVIDER_ID,
          url: `${CREATE_ENDPOINT}/${encodeURIComponent(taskId)}`,
          timeoutMs: 10_000,
          init: {
            method: 'GET',
            headers: { authorization: `Bearer ${apiKey}` },
          },
        });
        if (!pollRes.ok) {
          const text = await pollRes.text().catch(() => '');
          throw new ProviderHttpError(PROVIDER_ID, pollRes.status, text);
        }
        const poll = (await pollRes.json()) as MeshyTask;
        if (poll.status === 'SUCCEEDED') {
          const url = poll.model_urls?.glb;
          if (url === undefined) {
            throw new ProviderHttpError(PROVIDER_ID, 200, 'succeeded but no glb url');
          }
          return {
            providerId: PROVIDER_ID,
            modelId: MODEL_ID,
            modality: 'image',
            assets: [
              { url, mimeType: 'model/gltf-binary' },
            ],
            costMicrousd: 200_000, // ~$0.20 per preview model
            c2paManifest: buildC2paManifest({
              title: 'Meshy 3D model',
              format: 'model/gltf-binary',
              providerId: PROVIDER_ID,
              modelId: MODEL_ID,
              prompt: req.prompt,
              tenantId: req.tenantId,
              seed: 0,
              loraIds: req.brand?.loraIds ?? [],
              createdAtIso,
            }),
            createdAtIso,
          };
        }
        if (poll.status === 'FAILED' || poll.status === 'CANCELLED') {
          throw new ProviderHttpError(
            PROVIDER_ID,
            200,
            `meshy task ${poll.status}: ${poll.task_error?.message ?? 'unknown'}`,
          );
        }
        // else still PENDING / IN_PROGRESS — loop.
      }
    },
  };
}

interface MeshyTask {
  readonly status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  readonly model_urls?: { readonly glb?: string };
  readonly task_error?: { readonly message?: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function stubResult(req: ImageRequest, createdAtIso: string): ContentResult {
  const hash = deterministicHash(`${PROVIDER_ID}|${req.prompt}`);
  return {
    providerId: PROVIDER_ID,
    modelId: MODEL_ID,
    modality: 'image',
    assets: [
      { url: `https://stub.borjie.local/meshy/${hash}.glb`, mimeType: 'model/gltf-binary' },
    ],
    costMicrousd: 0,
    c2paManifest: buildC2paManifest({
      title: 'Meshy 3D model (stub)',
      format: 'model/gltf-binary',
      providerId: PROVIDER_ID,
      modelId: MODEL_ID,
      prompt: req.prompt,
      tenantId: req.tenantId,
      seed: 0,
      loraIds: req.brand?.loraIds ?? [],
      createdAtIso,
    }),
    createdAtIso,
  };
}

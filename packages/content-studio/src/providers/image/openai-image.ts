/**
 * OpenAI Image — `gpt-image-1` (and forward-compatible successors).
 *
 * Real fetch implementation. Hits `POST /v1/images/generations` and
 * returns the first asset URL from the response. Falls back to a base64
 * `data:` URL when the API returns `b64_json` only (which it does when
 * `response_format` is omitted for some models).
 *
 * Reference:
 *   - https://platform.openai.com/docs/api-reference/images/create
 *
 * Env vars (read lazily — never at module load):
 *   - OPENAI_API_KEY      (required to enable real calls)
 *   - OPENAI_IMAGE_MODEL  (optional, default `gpt-image-1`)
 *
 * Stub fallback: when the key is missing the provider degrades to a
 * deterministic placeholder URL (test-friendly), and `warnStubInvocation`
 * fires once in non-test mode so operators notice.
 */

import { buildC2paManifest } from '../../c2pa/attestation.js';
import {
  DEFAULT_TIMEOUTS,
  ProviderHttpError,
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
const SUPPORTED: ReadonlyArray<ImageTask> = ['hero_photoreal', 'text_in_image'];
const PROVIDER_ID = 'openai-image';
const DEFAULT_MODEL = 'gpt-image-1';
const ENDPOINT = 'https://api.openai.com/v1/images/generations';

export interface OpenAiImageProviderOptions {
  readonly timeoutMs?: number;
}

export function createOpenAiImageProvider(
  options: OpenAiImageProviderOptions = {},
): ImageProvider {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUTS.image;

  return {
    providerId: PROVIDER_ID,
    supportedTasks: SUPPORTED,

    async generate(req: ImageRequest): Promise<ContentResult> {
      const apiKey = readEnv('OPENAI_API_KEY');
      const modelId = readEnv('OPENAI_IMAGE_MODEL') ?? DEFAULT_MODEL;
      const createdAtIso = new Date().toISOString();

      if (apiKey === undefined) {
        warnStubInvocation(PROVIDER_ID, 'OPENAI_API_KEY');
        return stubResult(req, modelId, createdAtIso);
      }

      const body = {
        model: modelId,
        prompt: req.prompt,
        n: req.count ?? 1,
        size: aspectToOpenAiSize(req.aspectRatio),
      };

      const res = await fetchWithTimeout({
        providerId: PROVIDER_ID,
        url: ENDPOINT,
        timeoutMs,
        init: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ProviderHttpError(PROVIDER_ID, res.status, text);
      }

      const json = (await res.json()) as OpenAiImageResponse;
      const first = json.data?.[0];
      const url =
        first?.url ??
        (first?.b64_json !== undefined ? `data:image/png;base64,${first.b64_json}` : undefined);
      if (url === undefined) {
        throw new ProviderHttpError(
          PROVIDER_ID,
          res.status,
          'response missing both url and b64_json',
        );
      }

      const dims = sizeToDims(body.size);
      return {
        providerId: PROVIDER_ID,
        modelId,
        modality: 'image',
        assets: [
          {
            url,
            mimeType: 'image/png',
            widthPx: dims.widthPx,
            heightPx: dims.heightPx,
          },
        ],
        costMicrousd: estimateCostMicrousd(modelId, body.size),
        c2paManifest: buildC2paManifest({
          title: `OpenAI ${modelId} image`,
          format: 'image/png',
          providerId: PROVIDER_ID,
          modelId,
          prompt: req.prompt,
          tenantId: req.tenantId,
          seed: req.seed ?? 0,
          loraIds: req.brand?.loraIds ?? [],
          createdAtIso,
        }),
        createdAtIso,
      };
    },
  };
}

interface OpenAiImageResponse {
  readonly data?: ReadonlyArray<{
    readonly url?: string;
    readonly b64_json?: string;
  }>;
}

function aspectToOpenAiSize(aspect: ImageRequest['aspectRatio']): '1024x1024' | '1792x1024' | '1024x1792' {
  switch (aspect) {
    case '16:9':
    case '4:3':
      return '1792x1024';
    case '9:16':
    case '3:4':
      return '1024x1792';
    case '1:1':
    default:
      return '1024x1024';
  }
}

function sizeToDims(size: '1024x1024' | '1792x1024' | '1024x1792'): {
  widthPx: number;
  heightPx: number;
} {
  const [w, h] = size.split('x').map((n) => parseInt(n, 10));
  return { widthPx: w ?? 1024, heightPx: h ?? 1024 };
}

/** Rough public-list-price; refined by billing service downstream. */
function estimateCostMicrousd(modelId: string, size: string): number {
  // gpt-image-1 medium quality ~$0.04/img; high ~$0.08; we assume standard.
  if (modelId.startsWith('gpt-image')) {
    return size === '1024x1024' ? 40_000 : 80_000;
  }
  return 40_000;
}

function stubResult(req: ImageRequest, modelId: string, createdAtIso: string): ContentResult {
  const seed = req.seed ?? 0;
  const hash = deterministicHash(`${PROVIDER_ID}|${req.prompt}|${seed}`);
  return {
    providerId: PROVIDER_ID,
    modelId,
    modality: 'image',
    assets: [
      {
        url: `https://stub.borjie.local/openai-image/${hash}.png`,
        mimeType: 'image/png',
        widthPx: 1024,
        heightPx: 1024,
      },
    ],
    costMicrousd: 0,
    c2paManifest: buildC2paManifest({
      title: 'OpenAI image (stub)',
      format: 'image/png',
      providerId: PROVIDER_ID,
      modelId,
      prompt: req.prompt,
      tenantId: req.tenantId,
      seed,
      loraIds: req.brand?.loraIds ?? [],
      createdAtIso,
    }),
    createdAtIso,
  };
}

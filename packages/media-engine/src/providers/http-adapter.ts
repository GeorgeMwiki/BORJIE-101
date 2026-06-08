/**
 * Shared HTTP-adapter factory for real providers.
 *
 * Every real provider (Imagen / FLUX / Seedream / Sora / Veo / Seedance /
 * gif-transcoder) is a thin {@link MediaProvider} built from a spec: an
 * endpoint, a request-body builder, and a response→bytes extractor. The
 * factory enforces the hard rails uniformly:
 *   - api key + fetch are INJECTED via {@link ProviderInvocation}; the
 *     adapter never reads process.env.
 *   - when key OR fetch is missing it throws `provider_unconfigured`
 *     (degrade, never fabricate).
 *   - a non-2xx response throws `provider_failed` with the status.
 *   - empty bytes throw `provider_failed` (never claim a fake success).
 *
 * @module @borjie/media-engine/providers/http-adapter
 */

import type {
  MediaCapability,
  MediaFormat,
  MediaModality,
  MediaProviderId,
} from '../types.js';
import { MediaEngineError } from '../types.js';
import type {
  MediaProvider,
  ProviderInvocation,
  ProviderOutput,
} from './port.js';

/** Per-modality cost rates so the cost guard can pre-flight. */
export interface CostModel {
  /** Flat cents per image. */
  readonly perImageCents?: number;
  /** Cents per video second. */
  readonly perVideoSecondCents?: number;
  /** Cents per gif (transcode) operation. */
  readonly perGifCents?: number;
}

/** Declarative spec for an HTTP provider. */
export interface HttpProviderSpec {
  readonly id: MediaProviderId;
  readonly capabilities: ReadonlyArray<MediaCapability>;
  /** Resolve the endpoint for a modality. */
  readonly endpoint: (modality: MediaModality) => string;
  /** Build the JSON request body. */
  readonly buildBody: (invocation: ProviderInvocation) => unknown;
  /** Output container the provider returns per modality. */
  readonly format: (modality: MediaModality) => MediaFormat;
  /** True if this provider embeds an invisible SynthID watermark. */
  readonly synthId: boolean;
  readonly cost: CostModel;
  /** Auth header name (default `Authorization`). */
  readonly authHeader?: string;
  /** Prefix prepended to the key in the auth header (default `Bearer `). */
  readonly authPrefix?: string;
}

/**
 * Extract real bytes from a provider response. Supports two shapes:
 *   - `{ bytesBase64Encoded }` (Imagen `:predict`) → base64 decode.
 *   - a direct binary body (arrayBuffer) when the JSON parse is not an
 *     object — providers that return raw MP4/PNG content.
 * It NEVER fabricates bytes from a string field; a URL-only response is
 * treated as not-yet-downloaded and rejected with `provider_failed`
 * (the host's async job runner is responsible for downloads).
 */
async function extractBytes(
  res: { json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> },
): Promise<Uint8Array> {
  let parsed: unknown;
  let arrayBuf: ArrayBuffer | null = null;
  try {
    // Buffer the body once via arrayBuffer, then attempt a JSON parse.
    arrayBuf = await res.arrayBuffer();
    const text = new TextDecoder().decode(arrayBuf);
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    'bytesBase64Encoded' in parsed &&
    typeof (parsed as Record<string, unknown>).bytesBase64Encoded === 'string'
  ) {
    const b64 = String(
      (parsed as Record<string, unknown>).bytesBase64Encoded,
    );
    const bytes = base64ToBytes(b64);
    if (bytes.byteLength === 0) {
      throw new MediaEngineError('provider_failed', 'empty base64 payload');
    }
    return bytes;
  }
  // No recognised base64 field: treat the buffered body as raw binary.
  if (arrayBuf && arrayBuf.byteLength > 0 && parsed === undefined) {
    return new Uint8Array(arrayBuf);
  }
  throw new MediaEngineError(
    'provider_failed',
    'provider returned no downloadable bytes (URL-only or empty response)',
  );
}

function base64ToBytes(b64: string): Uint8Array {
  // Node + modern runtimes expose atob; decode without Buffer dependency.
  const bin = typeof atob === 'function' ? atob(b64) : '';
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function estimateCost(
  spec: HttpProviderSpec,
  modality: MediaModality,
  durationSec: number,
): number {
  if (modality === 'image') return spec.cost.perImageCents ?? 0;
  if (modality === 'gif') return spec.cost.perGifCents ?? 0;
  const perSec = spec.cost.perVideoSecondCents ?? 0;
  return Math.ceil(perSec * Math.max(durationSec, 1));
}

/** Build a real HTTP provider from a spec. */
export function createHttpProvider(spec: HttpProviderSpec): MediaProvider {
  return {
    id: spec.id,
    capabilities: spec.capabilities,
    requiresKey: true,
    estimateCostCents: (modality, durationSec) =>
      estimateCost(spec, modality, durationSec),
    generate: async (
      invocation: ProviderInvocation,
    ): Promise<ProviderOutput> => {
      const { apiKey, fetch, logger, modality } = invocation;
      if (!apiKey || !fetch) {
        // Degrade, never fabricate — the host falls back to another
        // provider (ultimately the stub) via the registry ladder.
        throw new MediaEngineError(
          'provider_unconfigured',
          `provider '${spec.id}' is not configured (missing key or fetch)`,
        );
      }
      const headerName = spec.authHeader ?? 'Authorization';
      const prefix = spec.authPrefix ?? 'Bearer ';
      let res;
      try {
        res = await fetch(spec.endpoint(modality), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [headerName]: `${prefix}${apiKey}`,
          },
          body: JSON.stringify(spec.buildBody(invocation)),
        });
      } catch (cause) {
        throw new MediaEngineError(
          'provider_failed',
          `provider '${spec.id}' request error`,
          cause,
        );
      }
      if (!res.ok) {
        throw new MediaEngineError(
          'provider_failed',
          `provider '${spec.id}' returned HTTP ${res.status}`,
        );
      }
      const body = await extractBytes(res);
      logger.info(
        { provider: spec.id, modality, bytes: body.byteLength },
        'media-engine provider produced bytes',
      );
      return {
        body,
        format: spec.format(modality),
        synthIdPresent: spec.synthId,
      };
    },
  };
}

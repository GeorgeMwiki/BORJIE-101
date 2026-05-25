/**
 * Krisp adapter — realtime noise/echo suppression.
 *
 * Krisp ships native SDKs; for backend usage we proxy through their REST
 * "Audio Cleaning" endpoint. The adapter contract is identical to Resemble
 * Enhance so callers swap with a single factory change.
 */

import {
  AudioCaptureError,
  type AudioChunk,
  type EnhancementSpec,
} from '../types.js';
import { toBodyInit } from '../_internal/bytes.js';
import type { EnhancementPort } from './index.js';

export interface KrispAdapterOptions {
  readonly apiKey?: string;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
}

export function createKrispAdapter(
  options: KrispAdapterOptions = {},
): EnhancementPort {
  const apiKey = options.apiKey ?? readEnv('KRISP_API_KEY');
  const endpoint = options.endpoint ?? 'https://api.krisp.ai/v1/clean';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const enhance = async (spec: EnhancementSpec): Promise<AudioChunk> => {
    if (!apiKey) {
      throw new AudioCaptureError(
        'KRISP_API_KEY missing — set env or pass apiKey',
        'NO_API_KEY',
      );
    }
    if (typeof fetchImpl !== 'function') {
      throw new AudioCaptureError('fetch missing', 'NO_FETCH');
    }
    const url = new URL(endpoint);
    url.searchParams.set('target', spec.target);
    const res = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: {
        'X-Krisp-Key': apiKey,
        'Content-Type': 'audio/wav',
      },
      body: toBodyInit(spec.audio.bytes),
    });
    if (!res.ok) {
      throw new AudioCaptureError(
        `Krisp ${res.status}: ${await res.text().catch(() => '')}`,
        'UPSTREAM_FAILURE',
      );
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { ...spec.audio, bytes };
  };

  return { provider: 'krisp', enhance };
}

function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Resemble Enhance adapter.
 *
 * Resemble Enhance specializes in voice — DNN-based denoise/dereverb that
 * preserves vocal fidelity. We POST audio bytes and receive enhanced bytes.
 */

import {
  AudioCaptureError,
  type AudioChunk,
  type EnhancementSpec,
} from '../types.js';
import { toBodyInit } from '../_internal/bytes.js';
import type { EnhancementPort } from './index.js';

export interface ResembleEnhanceAdapterOptions {
  readonly apiKey?: string;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
}

export function createResembleEnhanceAdapter(
  options: ResembleEnhanceAdapterOptions = {},
): EnhancementPort {
  const apiKey = options.apiKey ?? readEnv('RESEMBLE_API_KEY');
  const endpoint = options.endpoint ?? 'https://api.resemble.ai/v1/enhance';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const enhance = async (spec: EnhancementSpec): Promise<AudioChunk> => {
    if (!apiKey) {
      throw new AudioCaptureError(
        'RESEMBLE_API_KEY missing — set env or pass apiKey',
        'NO_API_KEY',
      );
    }
    if (typeof fetchImpl !== 'function') {
      throw new AudioCaptureError('fetch missing', 'NO_FETCH');
    }
    const url = new URL(endpoint);
    url.searchParams.set('mode', spec.target);
    const res = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'audio/wav',
      },
      body: toBodyInit(spec.audio.bytes),
    });
    if (!res.ok) {
      throw new AudioCaptureError(
        `Resemble ${res.status}: ${await res.text().catch(() => '')}`,
        'UPSTREAM_FAILURE',
      );
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { ...spec.audio, bytes };
  };

  return { provider: 'resemble-enhance', enhance };
}

function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

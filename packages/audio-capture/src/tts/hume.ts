/**
 * Hume AI EVI 3 (Empathic Voice Interface) TTS adapter.
 *
 * Hume's edge is *emotion-aware* synthesis. We pass the `EmotionHint.tone`
 * into the `prosody.emotion` field and `intensity` into `prosody.intensity`.
 * The vendor returns LPCM/MP3 — we wrap each frame into an AudioChunk.
 */

import {
  AudioCaptureError,
  type AudioChunk,
  type TTSRequest,
  type TTSResult,
} from '../types.js';
import type { TTSPort } from './index.js';

export interface HumeAdapterOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
}

interface HumeResponse {
  audio_base64?: string;
  audio_format?: string;
  sample_rate?: number;
  duration_ms?: number;
}

export function createHumeAdapter(
  options: HumeAdapterOptions = {},
): TTSPort {
  const apiKey = options.apiKey ?? readEnv('HUME_API_KEY');
  const model = options.model ?? 'evi-3';
  const endpoint = options.endpoint ?? 'https://api.hume.ai/v0/tts';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const synthesize = async (request: TTSRequest): Promise<TTSResult> => {
    if (!apiKey) {
      throw new AudioCaptureError(
        'HUME_API_KEY missing — set env or pass apiKey',
        'NO_API_KEY',
      );
    }
    if (typeof fetchImpl !== 'function') {
      throw new AudioCaptureError('fetch missing', 'NO_FETCH');
    }
    const body = {
      text: request.text,
      voice: { id: request.voiceId },
      model,
      prosody: {
        emotion: request.emotion?.tone ?? 'neutral',
        intensity: request.emotion?.intensity ?? 0.5,
      },
      output: { format: request.format, sample_rate: request.sampleRate ?? 24000 },
    };
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'X-Hume-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new AudioCaptureError(
        `Hume ${res.status}: ${await res.text().catch(() => '')}`,
        'UPSTREAM_FAILURE',
      );
    }
    const json = (await res.json()) as HumeResponse;
    const bytes = decodeBase64(json.audio_base64 ?? '');
    return {
      audio: {
        bytes,
        format: request.format,
        sampleRate: request.sampleRate ?? 24000,
        channels: 1,
        durationMs: json.duration_ms ?? Math.max(request.text.length * 60, 100),
      },
      voiceId: request.voiceId,
      modelId: model,
      characters: request.text.length,
    };
  };

  const streamSynthesize = async function* (
    request: TTSRequest,
  ): AsyncIterable<AudioChunk> {
    // Hume's streaming API is gRPC-only — for fetch consumers we synthesize
    // one-shot then slice into ~150ms windows.
    const result = await synthesize(request);
    const sliceSize = Math.max(1024, Math.floor(result.audio.bytes.byteLength / 4));
    for (let i = 0; i < result.audio.bytes.byteLength; i += sliceSize) {
      yield {
        bytes: result.audio.bytes.subarray(i, Math.min(i + sliceSize, result.audio.bytes.byteLength)),
        format: result.audio.format,
        sampleRate: result.audio.sampleRate,
        channels: result.audio.channels,
        sequence: Math.floor(i / sliceSize),
      };
    }
  };

  return { modelId: model, provider: 'hume', synthesize, streamSynthesize };
}

function decodeBase64(b64: string): Uint8Array {
  if (b64 === '') return new Uint8Array(0);
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  const binary = typeof g.atob === 'function' ? g.atob(b64) : '';
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

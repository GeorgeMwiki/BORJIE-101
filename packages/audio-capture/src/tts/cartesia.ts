/**
 * Cartesia Sonic-2 TTS adapter — same vendor as the Cartesia STT, paired so
 * a session that uses Sonic-2 STT can sit on top of Sonic-2 TTS for ~250ms
 * end-to-end roundtrip.
 */

import {
  AudioCaptureError,
  type AudioChunk,
  type TTSRequest,
  type TTSResult,
} from '../types.js';
import type { TTSPort } from './index.js';

export interface CartesiaTTSAdapterOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
}

export function createCartesiaTTSAdapter(
  options: CartesiaTTSAdapterOptions = {},
): TTSPort {
  const apiKey = options.apiKey ?? readEnv('CARTESIA_API_KEY');
  const model = options.model ?? 'sonic-2';
  const endpoint = options.endpoint ?? 'https://api.cartesia.ai/tts/bytes';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const synthesize = async (request: TTSRequest): Promise<TTSResult> => {
    if (!apiKey) {
      throw new AudioCaptureError(
        'CARTESIA_API_KEY missing — set env or pass apiKey',
        'NO_API_KEY',
      );
    }
    if (typeof fetchImpl !== 'function') {
      throw new AudioCaptureError('fetch missing', 'NO_FETCH');
    }
    const body = {
      model_id: model,
      voice: { id: request.voiceId, mode: 'id' },
      transcript: request.text,
      output_format: {
        container: request.format,
        encoding: request.format === 'pcm' ? 'pcm_s16le' : undefined,
        sample_rate: request.sampleRate ?? 24000,
      },
    };
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Cartesia-Version': '2026-01-01',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new AudioCaptureError(
        `Cartesia TTS ${res.status}: ${await res.text().catch(() => '')}`,
        'UPSTREAM_FAILURE',
      );
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      audio: {
        bytes,
        format: request.format,
        sampleRate: request.sampleRate ?? 24000,
        channels: 1,
      },
      voiceId: request.voiceId,
      modelId: model,
      characters: request.text.length,
    };
  };

  const streamSynthesize = async function* (
    request: TTSRequest,
  ): AsyncIterable<AudioChunk> {
    // Cartesia streaming uses WebSocket; for fetch we one-shot + slice.
    const result = await synthesize(request);
    const slice = Math.max(1024, Math.floor(result.audio.bytes.byteLength / 6));
    for (let i = 0; i < result.audio.bytes.byteLength; i += slice) {
      yield {
        bytes: result.audio.bytes.subarray(i, Math.min(i + slice, result.audio.bytes.byteLength)),
        format: result.audio.format,
        sampleRate: result.audio.sampleRate,
        channels: result.audio.channels,
        sequence: Math.floor(i / slice),
      };
    }
  };

  return { modelId: model, provider: 'cartesia-tts', synthesize, streamSynthesize };
}

function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

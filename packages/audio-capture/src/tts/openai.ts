/**
 * OpenAI TTS-1-HD adapter.
 *
 * Simple POST to `/v1/audio/speech` returns audio bytes. Streaming is a
 * chunked HTTP response; we wrap each Reader read into an AudioChunk.
 */

import {
  AudioCaptureError,
  type AudioChunk,
  type TTSRequest,
  type TTSResult,
} from '../types.js';
import type { TTSPort } from './index.js';

export interface OpenAITTSAdapterOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
}

export function createOpenAITTSAdapter(
  options: OpenAITTSAdapterOptions = {},
): TTSPort {
  const apiKey = options.apiKey ?? readEnv('OPENAI_API_KEY');
  const model = options.model ?? 'tts-1-hd';
  const endpoint = options.endpoint ?? 'https://api.openai.com/v1/audio/speech';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const callOnce = async (request: TTSRequest): Promise<Response> => {
    if (!apiKey) {
      throw new AudioCaptureError(
        'OPENAI_API_KEY missing — set env or pass apiKey',
        'NO_API_KEY',
      );
    }
    if (typeof fetchImpl !== 'function') {
      throw new AudioCaptureError('fetch missing', 'NO_FETCH');
    }
    const body = {
      model,
      input: request.text,
      voice: request.voiceId,
      response_format: request.format === 'pcm' ? 'pcm' : request.format,
      speed: request.speed ?? 1,
    };
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new AudioCaptureError(
        `OpenAI TTS ${res.status}: ${await res.text().catch(() => '')}`,
        'UPSTREAM_FAILURE',
      );
    }
    return res;
  };

  const synthesize = async (request: TTSRequest): Promise<TTSResult> => {
    const res = await callOnce(request);
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
    const res = await callOnce(request);
    if (!res.body) {
      throw new AudioCaptureError(
        'OpenAI TTS stream missing body',
        'EMPTY_BODY',
      );
    }
    const reader = res.body.getReader();
    let sequence = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        yield {
          bytes: value,
          format: request.format,
          sampleRate: request.sampleRate ?? 24000,
          channels: 1,
          sequence: sequence++,
        };
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
  };

  return { modelId: model, provider: 'openai-tts', synthesize, streamSynthesize };
}

function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

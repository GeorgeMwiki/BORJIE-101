/**
 * ElevenLabs Eleven-v3 TTS adapter.
 *
 * Eleven-v3 (Q1-2026) supports multilingual voice cloning, SSML, and a
 * 96-emotion palette via "voice_settings.style". We POST `/v1/text-to-speech/
 * {voiceId}` for one-shot synthesis and `/v1/text-to-speech/{voiceId}/stream`
 * for chunked audio — the stream endpoint returns audio bytes incrementally
 * which we wrap into `AudioChunk` events.
 */

import {
  AudioCaptureError,
  type AudioChunk,
  type TTSRequest,
  type TTSResult,
} from '../types.js';
import type { TTSPort } from './index.js';

export interface ElevenLabsAdapterOptions {
  readonly apiKey?: string;
  readonly voiceId?: string;
  readonly model?: string;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
}

export function createElevenLabsAdapter(
  options: ElevenLabsAdapterOptions = {},
): TTSPort {
  const apiKey = options.apiKey ?? readEnv('ELEVENLABS_API_KEY');
  const defaultVoiceId = options.voiceId ?? 'rachel';
  const model = options.model ?? 'eleven-v3';
  const endpoint = options.endpoint ?? 'https://api.elevenlabs.io/v1/text-to-speech';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const callOnce = async (
    request: TTSRequest,
    stream: boolean,
  ): Promise<Response> => {
    if (!apiKey) {
      throw new AudioCaptureError(
        'ELEVENLABS_API_KEY missing — set env or pass apiKey',
        'NO_API_KEY',
      );
    }
    if (typeof fetchImpl !== 'function') {
      throw new AudioCaptureError('fetch missing', 'NO_FETCH');
    }
    const voiceId = request.voiceId || defaultVoiceId;
    const url = stream
      ? `${endpoint}/${encodeURIComponent(voiceId)}/stream`
      : `${endpoint}/${encodeURIComponent(voiceId)}`;
    const body = {
      text: request.text,
      model_id: model,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: request.emotion?.intensity ?? 0,
      },
      output_format: outputFormatFor(request),
    };
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'content-type': 'application/json',
        accept: stream ? 'audio/mpeg' : `audio/${request.format}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new AudioCaptureError(
        `ElevenLabs ${res.status}: ${await res.text().catch(() => '')}`,
        'UPSTREAM_FAILURE',
      );
    }
    return res;
  };

  const synthesize = async (request: TTSRequest): Promise<TTSResult> => {
    const res = await callOnce(request, false);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      audio: {
        bytes,
        format: request.format,
        sampleRate: request.sampleRate ?? 24000,
        channels: 1,
      },
      voiceId: request.voiceId || defaultVoiceId,
      modelId: model,
      characters: request.text.length,
    };
  };

  const streamSynthesize = async function* (
    request: TTSRequest,
  ): AsyncIterable<AudioChunk> {
    const res = await callOnce(request, true);
    if (!res.body) {
      throw new AudioCaptureError(
        'ElevenLabs stream missing body',
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

  return {
    modelId: model,
    provider: 'elevenlabs',
    synthesize,
    streamSynthesize,
  };
}

function outputFormatFor(request: TTSRequest): string {
  const rate = request.sampleRate ?? 24000;
  switch (request.format) {
    case 'mp3':
      return `mp3_${rate}_128`;
    case 'opus':
      return `opus_${rate}_64`;
    case 'pcm':
      return `pcm_${rate}`;
    default:
      return `mp3_${rate}_128`;
  }
}

function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

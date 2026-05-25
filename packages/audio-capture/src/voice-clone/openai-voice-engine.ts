/**
 * OpenAI Voice Engine adapter.
 *
 * Voice Engine is OpenAI's voice cloning preview — 15-second sample creates
 * a reusable voice usable by TTS-1 / GPT-4o-realtime. We POST audio + a name
 * and the response includes a `voice_id` we treat as the canonical clone ID.
 */

import {
  AudioCaptureError,
  type EmotionHint,
  type Language,
  type SampleRate,
  type VoiceClone,
  type VoiceCloneRequest,
} from '../types.js';
import type { VoiceClonePort } from './index.js';

export interface OpenAIVoiceEngineOptions {
  readonly apiKey?: string;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
}

interface OpenAIVoiceCreateResponse {
  voice_id?: string;
  name?: string;
  languages?: ReadonlyArray<string>;
}

const OPENAI_VOICE_LANGUAGES: ReadonlyArray<Language> = [
  'en',
  'sw',
  'es',
  'fr',
  'pt',
  'ar',
  'zh',
] as const;

const OPENAI_VOICE_EMOTIONS: ReadonlyArray<NonNullable<EmotionHint['tone']>> = [
  'neutral',
  'cheerful',
  'empathetic',
] as const;

export function createOpenAIVoiceEngine(
  options: OpenAIVoiceEngineOptions = {},
): VoiceClonePort {
  const apiKey = options.apiKey ?? readEnv('OPENAI_API_KEY');
  const endpoint = options.endpoint ?? 'https://api.openai.com/v1/voice/create';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const createClone = async (
    request: VoiceCloneRequest,
  ): Promise<VoiceClone> => {
    if (!apiKey) {
      throw new AudioCaptureError(
        'OPENAI_API_KEY missing — set env or pass apiKey',
        'NO_API_KEY',
      );
    }
    if (typeof fetchImpl !== 'function') {
      throw new AudioCaptureError('fetch missing', 'NO_FETCH');
    }
    if (request.samples.length === 0) {
      throw new AudioCaptureError(
        'voice clone requires at least one sample',
        'NO_SAMPLES',
      );
    }
    const sample = request.samples[0];
    if (!sample) {
      throw new AudioCaptureError(
        'voice clone requires a sample audio',
        'NO_SAMPLES',
      );
    }
    const form = new FormData();
    form.append('name', request.name);
    if (request.description) form.append('description', request.description);
    const blob = new Blob([asArrayBuffer(sample.audio.bytes)], {
      type: 'audio/wav',
    });
    form.append('sample', blob, 'sample.wav');
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new AudioCaptureError(
        `OpenAI voice/create ${res.status}: ${await res.text().catch(() => '')}`,
        'UPSTREAM_FAILURE',
      );
    }
    const json = (await res.json()) as OpenAIVoiceCreateResponse;
    const sampleRate: SampleRate =
      (sample.audio.sampleRate as SampleRate | undefined) ?? 24000;
    const supportedLanguages: ReadonlyArray<Language> = request.languages ??
      ((json.languages as ReadonlyArray<Language> | undefined) ?? OPENAI_VOICE_LANGUAGES);
    return {
      id: json.voice_id ?? 'unknown',
      name: json.name ?? request.name,
      provider: 'openai',
      supportedLanguages,
      supportedEmotions: OPENAI_VOICE_EMOTIONS,
      sampleRate,
      createdAtMs: Date.now(),
    };
  };

  return { provider: 'openai-voice-engine', createClone };
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

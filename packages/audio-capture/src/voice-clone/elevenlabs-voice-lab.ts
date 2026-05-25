/**
 * ElevenLabs Voice Lab adapter.
 *
 * Voice Lab takes multiple sample WAVs (≥30s recommended) and returns a
 * cloned voice usable across ElevenLabs' 32 supported languages with
 * stylistic transfer via the `style` voice setting.
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

export interface ElevenLabsVoiceLabOptions {
  readonly apiKey?: string;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
}

interface ElevenLabsVoiceCreateResponse {
  voice_id?: string;
  name?: string;
}

const ELEVEN_LABS_LANGUAGES: ReadonlyArray<Language> = [
  'en',
  'en-KE',
  'en-TZ',
  'sw',
  'sw-KE',
  'sw-TZ',
  'fr',
  'pt',
  'pt-BR',
  'es',
  'ar',
  'zh',
] as const;

const ELEVEN_LABS_EMOTIONS: ReadonlyArray<NonNullable<EmotionHint['tone']>> = [
  'neutral',
  'cheerful',
  'sad',
  'angry',
  'apologetic',
  'empathetic',
  'urgent',
] as const;

export function createElevenLabsVoiceLab(
  options: ElevenLabsVoiceLabOptions = {},
): VoiceClonePort {
  const apiKey = options.apiKey ?? readEnv('ELEVENLABS_API_KEY');
  const endpoint = options.endpoint ?? 'https://api.elevenlabs.io/v1/voices/add';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const createClone = async (
    request: VoiceCloneRequest,
  ): Promise<VoiceClone> => {
    if (!apiKey) {
      throw new AudioCaptureError(
        'ELEVENLABS_API_KEY missing — set env or pass apiKey',
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
    const form = new FormData();
    form.append('name', request.name);
    if (request.description) form.append('description', request.description);
    request.samples.forEach((sample, idx) => {
      const blob = new Blob([asArrayBuffer(sample.audio.bytes)], {
        type: 'audio/wav',
      });
      form.append('files', blob, `sample_${idx}.wav`);
    });
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
    });
    if (!res.ok) {
      throw new AudioCaptureError(
        `ElevenLabs voices/add ${res.status}: ${await res.text().catch(() => '')}`,
        'UPSTREAM_FAILURE',
      );
    }
    const json = (await res.json()) as ElevenLabsVoiceCreateResponse;
    const sampleRate: SampleRate =
      (request.samples[0]?.audio.sampleRate as SampleRate | undefined) ?? 24000;
    return {
      id: json.voice_id ?? 'unknown',
      name: json.name ?? request.name,
      provider: 'elevenlabs',
      supportedLanguages: request.languages ?? ELEVEN_LABS_LANGUAGES,
      supportedEmotions: ELEVEN_LABS_EMOTIONS,
      sampleRate,
      createdAtMs: Date.now(),
    };
  };

  return { provider: 'elevenlabs-voice-lab', createClone };
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

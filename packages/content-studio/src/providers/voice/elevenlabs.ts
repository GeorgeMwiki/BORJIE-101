/**
 * ElevenLabs v3 — multilingual + emotional TTS.
 *
 * Real fetch implementation against
 * `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}`.
 * The endpoint returns raw audio bytes (default `audio/mpeg`); we buffer
 * the bytes and surface them as a `data:` URL inside `ContentAsset.url`
 * for the simplest possible downstream contract. Callers that need to
 * push the audio to object storage do so from the buffer (see the
 * `sizeBytes` field).
 *
 * Reference:
 *   - https://elevenlabs.io/docs/api-reference/text-to-speech/convert
 *   - Swahili TTS: https://elevenlabs.io/text-to-speech/swahili
 *
 * Env vars (read lazily — never at module load):
 *   - ELEVENLABS_API_KEY              (required for real calls)
 *   - ELEVENLABS_MODEL_TTS            (optional, default `eleven_multilingual_v2`)
 *   - ELEVENLABS_DEFAULT_VOICE_ID     (optional, fallback voice when req has none)
 *
 * Stub fallback: when the key is missing the provider returns a
 * deterministic placeholder MP3 URL and emits a one-shot warning in
 * non-test mode.
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
  LanguageTag,
  VoiceProvider,
  VoiceRequest,
  VoiceTask,
} from '../../types.js';

export const STUB_PROVIDER = false; // becomes a stub at runtime only if key is missing
const SUPPORTED: ReadonlyArray<VoiceTask> = ['narration', 'agent_realtime'];
const PROVIDER_ID = 'elevenlabs';
const DEFAULT_MODEL = 'eleven_multilingual_v2';
const FALLBACK_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel — ElevenLabs default

// Subset relevant to Borjie's footprint; real provider exposes 70+.
const SUPPORTED_LANGS: ReadonlySet<string> = new Set([
  'en', 'sw', 'ha', 'ln', 'ny', 'so', 'fr', 'pt', 'ar',
]);

export interface ElevenLabsProviderOptions {
  readonly timeoutMs?: number;
}

export function createElevenLabsProvider(
  options: ElevenLabsProviderOptions = {},
): VoiceProvider {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUTS.voice;

  return {
    providerId: PROVIDER_ID,
    supportedTasks: SUPPORTED,

    supportsLanguage(lang: LanguageTag): boolean {
      const base = lang.toLowerCase().split('-')[0] ?? '';
      return SUPPORTED_LANGS.has(base);
    },

    async synthesize(req: VoiceRequest): Promise<ContentResult> {
      const apiKey = readEnv('ELEVENLABS_API_KEY');
      const modelId = readEnv('ELEVENLABS_MODEL_TTS') ?? DEFAULT_MODEL;
      const defaultVoice = readEnv('ELEVENLABS_DEFAULT_VOICE_ID') ?? FALLBACK_VOICE_ID;
      const voiceId =
        req.voiceId ?? req.brand?.elevenLabsVoiceId ?? defaultVoice;
      const createdAtIso = new Date().toISOString();

      if (apiKey === undefined) {
        warnStubInvocation(PROVIDER_ID, 'ELEVENLABS_API_KEY');
        return stubResult(req, voiceId, modelId, createdAtIso);
      }

      const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;
      const res = await fetchWithTimeout({
        providerId: PROVIDER_ID,
        url,
        timeoutMs,
        init: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'audio/mpeg',
            'xi-api-key': apiKey,
          },
          body: JSON.stringify({
            text: req.text,
            model_id: modelId,
            voice_settings: voiceSettings(req.emotion),
          }),
        },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ProviderHttpError(PROVIDER_ID, res.status, text);
      }

      const buf = Buffer.from(await res.arrayBuffer());
      const dataUrl = `data:audio/mpeg;base64,${buf.toString('base64')}`;
      // ~$0.05 per 1k chars reference price.
      const cost = Math.max(1, Math.ceil(req.text.length / 1000)) * 50_000;
      return {
        providerId: PROVIDER_ID,
        modelId,
        modality: 'voice',
        assets: [
          {
            url: dataUrl,
            mimeType: 'audio/mpeg',
            sizeBytes: buf.length,
            durationSeconds: Math.max(1, Math.ceil(req.text.length / 18)),
          },
        ],
        costMicrousd: cost,
        c2paManifest: buildC2paManifest({
          title: 'ElevenLabs synthesized audio',
          format: 'audio/mpeg',
          providerId: PROVIDER_ID,
          modelId,
          prompt: req.text,
          tenantId: req.tenantId,
          seed: 0,
          loraIds: [voiceId],
          createdAtIso,
        }),
        createdAtIso,
      };
    },
  };
}

function voiceSettings(emotion: VoiceRequest['emotion']): Record<string, number> {
  // Map our coarse emotion enum to ElevenLabs sliders. Defaults track the
  // public "balanced" preset.
  switch (emotion) {
    case 'warm':
      return { stability: 0.55, similarity_boost: 0.75, style: 0.35 };
    case 'firm':
      return { stability: 0.80, similarity_boost: 0.70, style: 0.10 };
    case 'cheerful':
      return { stability: 0.45, similarity_boost: 0.80, style: 0.55 };
    case 'neutral':
    default:
      return { stability: 0.5, similarity_boost: 0.75, style: 0.0 };
  }
}

function stubResult(
  req: VoiceRequest,
  voiceId: string,
  modelId: string,
  createdAtIso: string,
): ContentResult {
  const hash = deterministicHash(`${PROVIDER_ID}|${voiceId}|${req.language}|${req.text}`);
  const cost = Math.max(1, Math.ceil(req.text.length / 1000)) * 50_000;
  return {
    providerId: PROVIDER_ID,
    modelId,
    modality: 'voice',
    assets: [
      {
        url: `https://stub.borjie.local/elevenlabs/${hash}.mp3`,
        mimeType: 'audio/mpeg',
        durationSeconds: Math.max(1, Math.ceil(req.text.length / 18)),
      },
    ],
    costMicrousd: cost,
    c2paManifest: buildC2paManifest({
      title: 'ElevenLabs synthesized audio (stub)',
      format: 'audio/mpeg',
      providerId: PROVIDER_ID,
      modelId,
      prompt: req.text,
      tenantId: req.tenantId,
      seed: 0,
      loraIds: [voiceId],
      createdAtIso,
    }),
    createdAtIso,
  };
}

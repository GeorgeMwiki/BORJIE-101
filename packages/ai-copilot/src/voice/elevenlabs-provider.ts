/**
 * ElevenLabs voice provider (Wave 11).
 *
 * Handles both STT (scribe_v2) and TTS (eleven_v3). Swahili + English both
 * supported natively. Voice IDs read from config (normally
 * `ELEVENLABS_DEFAULT_VOICE_ID`).
 *
 * Ported from LitFin's voice substrate. Kept focused: no live streaming here
 * (see `voice-session.ts` for the conversational loop).
 */

import { getModelLatest } from '@borjie/brain-llm-router/dynamic-registry';
import type {
  VoiceProvider,
  VoiceLanguage,
  TranscribeRequest,
  TranscribeResponse,
  SynthesizeRequest,
  SynthesizeResponse,
  VoiceResult,
  VoiceProviderError,
} from './types.js';
import { vOk, vErr } from './types.js';

export interface ElevenLabsProviderConfig {
  readonly apiKey: string;
  readonly defaultVoiceId: string;
  readonly baseUrl?: string;
  readonly sttModelId?: string; // default 'scribe_v2'
  readonly ttsModelId?: string; // default 'eleven_v3'
  readonly timeoutMs?: number;
}

export class ElevenLabsProvider implements VoiceProvider {
  readonly providerId = 'elevenlabs';
  readonly supportedLanguages: readonly VoiceLanguage[] = [
    'en',
    'sw',
    'mixed',
  ];

  private readonly config: ElevenLabsProviderConfig;

  constructor(config: ElevenLabsProviderConfig) {
    if (!config.apiKey) {
      throw new Error(
        'ElevenLabsProvider: apiKey is required (set ELEVENLABS_API_KEY).'
      );
    }
    if (!config.defaultVoiceId) {
      throw new Error(
        'ElevenLabsProvider: defaultVoiceId is required (set ELEVENLABS_DEFAULT_VOICE_ID).'
      );
    }
    this.config = config;
  }

  supportsLanguage(lang: VoiceLanguage): boolean {
    return this.supportedLanguages.includes(lang);
  }

  async transcribe(
    request: TranscribeRequest
  ): Promise<VoiceResult<TranscribeResponse>> {
    if (!validAudio(request.audio)) {
      return vErr({
        code: 'INVALID_AUDIO',
        message: 'Audio payload is empty or malformed',
        provider: this.providerId,
        retryable: false,
      });
    }
    const sttModel = this.config.sttModelId ?? getModelLatest('eleven-stt');
    const timeoutMs = this.config.timeoutMs ?? 60_000;
    const base = this.config.baseUrl ?? 'https://api.elevenlabs.io';

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const form = new FormData();
      form.append(
        'file',
        new Blob([request.audio as ArrayBuffer], {
          type: request.mimeType ?? 'audio/mpeg',
        }),
        'audio'
      );
      form.append('model_id', sttModel);
      if (request.language !== 'mixed') {
        form.append('language_code', request.language);
      }
      if (request.diarize) form.append('diarize', 'true');
      if (request.prompt) form.append('prompt', request.prompt);

      const resp = await fetch(`${base}/v1/speech-to-text`, {
        method: 'POST',
        headers: { 'xi-api-key': this.config.apiKey },
        body: form,
        signal: controller.signal,
      });
      clearTimeout(tid);
      if (!resp.ok) return mapHttp(this.providerId, resp.status, await safeJson(resp));
      const data = (await resp.json()) as {
        text?: string;
        language_code?: string;
        duration_seconds?: number;
      };
      return vOk({
        text: data.text ?? '',
        language:
          (data.language_code as VoiceLanguage) ?? request.language,
        durationSec: data.duration_seconds ?? 0,
        providerId: this.providerId,
        model: sttModel,
      });
    } catch (err) {
      clearTimeout(tid);
      return vErr(errToVoiceError(this.providerId, err, timeoutMs));
    }
  }

  async synthesize(
    request: SynthesizeRequest
  ): Promise<VoiceResult<SynthesizeResponse>> {
    if (!request.text || request.text.trim() === '') {
      return vErr({
        code: 'INVALID_AUDIO',
        message: 'Text is empty',
        provider: this.providerId,
        retryable: false,
      });
    }
    const ttsModel = this.config.ttsModelId ?? getModelLatest('eleven-tts');
    const voiceId = request.voiceId ?? this.config.defaultVoiceId;
    const timeoutMs = this.config.timeoutMs ?? 60_000;
    const base = this.config.baseUrl ?? 'https://api.elevenlabs.io';
    const format = request.format ?? 'mp3_44100_128';

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(
        `${base}/v1/text-to-speech/${voiceId}?output_format=${format}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': this.config.apiKey,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify({
            text: request.text,
            model_id: ttsModel,
            voice_settings: {
              stability: request.stability ?? 0.5,
              similarity_boost: request.similarityBoost ?? 0.75,
            },
          }),
          signal: controller.signal,
        }
      );
      clearTimeout(tid);
      if (!resp.ok) return mapHttp(this.providerId, resp.status, await safeJson(resp));
      const buf = new Uint8Array(await resp.arrayBuffer());
      return vOk({
        audio: buf,
        mimeType: 'audio/mpeg',
        providerId: this.providerId,
        model: ttsModel,
        voiceId,
      });
    } catch (err) {
      clearTimeout(tid);
      return vErr(errToVoiceError(this.providerId, err, timeoutMs));
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const base = this.config.baseUrl ?? 'https://api.elevenlabs.io';
      const resp = await fetch(`${base}/v1/voices`, {
        headers: { 'xi-api-key': this.config.apiKey },
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}

function validAudio(audio: Uint8Array | ArrayBuffer): boolean {
  if (!audio) return false;
  if (audio instanceof Uint8Array) return audio.byteLength > 0;
  if (audio instanceof ArrayBuffer) return audio.byteLength > 0;
  return false;
}

async function safeJson(resp: Response): Promise<Record<string, unknown>> {
  try {
    return (await resp.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapHttp(
  provider: string,
  status: number,
  body: Record<string, unknown>
): VoiceResult<never> {
  const msg = String(
    (body.detail as Record<string, unknown>)?.message ??
      (body.error as Record<string, unknown>)?.message ??
      body.message ??
      'provider error'
  );
  if (status === 429) {
    return vErr({
      code: 'RATE_LIMIT',
      message: msg,
      provider,
      retryable: true,
      statusCode: status,
    });
  }
  if (status === 400) {
    return vErr({
      code: 'INVALID_AUDIO',
      message: msg,
      provider,
      retryable: false,
      statusCode: status,
    });
  }
  return vErr({
    code: 'PROVIDER_ERROR',
    message: msg,
    provider,
    retryable: status >= 500,
    statusCode: status,
  });
}

function errToVoiceError(
  provider: string,
  err: unknown,
  timeoutMs: number
): VoiceProviderError {
  if (err instanceof Error && err.name === 'AbortError') {
    return {
      code: 'TIMEOUT',
      message: `Voice request timed out after ${timeoutMs}ms`,
      provider,
      retryable: true,
    };
  }
  return {
    code: 'PROVIDER_ERROR',
    message: err instanceof Error ? err.message : String(err),
    provider,
    retryable: true,
  };
}

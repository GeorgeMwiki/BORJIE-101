/**
 * OpenAI voice provider (Wave 11 — STT + TTS fallback).
 *
 * Uses `gpt-4o-mini-transcribe` for STT and `gpt-4o-mini-tts` for TTS.
 *
 * OpenAI's Swahili support is weaker than ElevenLabs'; the router demotes
 * OpenAI for Swahili requests automatically (see `voice-router.ts`).
 */

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

export interface OpenAIVoiceProviderConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly sttModel?: string; // default 'gpt-4o-mini-transcribe'
  readonly ttsModel?: string; // default 'gpt-4o-mini-tts'
  readonly defaultVoice?: string; // default 'alloy'
  readonly timeoutMs?: number;
}

export class OpenAIVoiceProvider implements VoiceProvider {
  readonly providerId = 'openai-voice';
  readonly supportedLanguages: readonly VoiceLanguage[] = ['en', 'mixed'];

  private readonly config: OpenAIVoiceProviderConfig;

  constructor(config: OpenAIVoiceProviderConfig) {
    if (!config.apiKey) {
      throw new Error(
        'OpenAIVoiceProvider: apiKey is required (set OPENAI_API_KEY).'
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
    const sttModel = this.config.sttModel ?? 'gpt-4o-mini-transcribe';
    const base = this.config.baseUrl ?? 'https://api.openai.com';
    const timeoutMs = this.config.timeoutMs ?? 60_000;

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const form = new FormData();
      form.append(
        'file',
        new Blob([request.audio as ArrayBuffer], {
          type: request.mimeType ?? 'audio/mpeg',
        }),
        'audio.mp3'
      );
      form.append('model', sttModel);
      if (request.language !== 'mixed') form.append('language', request.language);
      if (request.prompt) form.append('prompt', request.prompt);

      const resp = await fetch(`${base}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        body: form,
        signal: controller.signal,
      });
      clearTimeout(tid);
      if (!resp.ok) return mapHttp(this.providerId, resp.status, await safeJson(resp));
      const data = (await resp.json()) as {
        text?: string;
        language?: string;
        duration?: number;
      };
      return vOk({
        text: data.text ?? '',
        language: (data.language as VoiceLanguage) ?? request.language,
        durationSec: data.duration ?? 0,
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
    if (request.language === 'sw') {
      return vErr({
        code: 'UNSUPPORTED_LANGUAGE',
        message: 'OpenAI voice Swahili quality is insufficient; prefer ElevenLabs',
        provider: this.providerId,
        retryable: false,
      });
    }
    const ttsModel = this.config.ttsModel ?? 'gpt-4o-mini-tts';
    const voice = request.voiceId ?? this.config.defaultVoice ?? 'alloy';
    const base = this.config.baseUrl ?? 'https://api.openai.com';
    const timeoutMs = this.config.timeoutMs ?? 60_000;

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(`${base}/v1/audio/speech`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: ttsModel,
          voice,
          input: request.text,
          response_format: 'mp3',
        }),
        signal: controller.signal,
      });
      clearTimeout(tid);
      if (!resp.ok) return mapHttp(this.providerId, resp.status, await safeJson(resp));
      const buf = new Uint8Array(await resp.arrayBuffer());
      return vOk({
        audio: buf,
        mimeType: 'audio/mpeg',
        providerId: this.providerId,
        model: ttsModel,
        voiceId: voice,
      });
    } catch (err) {
      clearTimeout(tid);
      return vErr(errToVoiceError(this.providerId, err, timeoutMs));
    }
  }

  async healthCheck(): Promise<boolean> {
    return Boolean(this.config.apiKey);
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
      message: `OpenAI voice request timed out after ${timeoutMs}ms`,
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

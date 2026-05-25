/**
 * ElevenLabs v3 — multilingual TTS, primary for Swahili / Bantu / Sheng / Yo /
 * Ig / Ha (see `router/tts-router.ts`).
 *
 * Real implementation: POST `https://api.elevenlabs.io/v1/text-to-speech/
 * {voice_id}/stream` with `xi-api-key: $ELEVENLABS_API_KEY`. We read the
 * response body as a stream and re-chunk into 4 KB PartialAudio frames so the
 * downstream caller can start playback before the full audio arrives.
 *
 * Required env: `ELEVENLABS_API_KEY`. Optional:
 *   - `ELEVENLABS_DEFAULT_VOICE_ID` (fallback when `options.voiceId` unset)
 *   - `ELEVENLABS_MODEL_TTS`        (fallback model id)
 *
 * Returns an error frame (not a throw) when the upstream returns non-200,
 * per the task spec.
 */
/* eslint-disable no-console */

import {
  AsyncQueue,
  DEFAULT_TTS_TOTAL_TIMEOUT_MS,
  fetchWithTimeout,
  readEnv,
  warnOnce,
} from './_runtime.js';
import type {
  PartialAudio,
  ProviderName,
  StartSessionOptions,
  TtsProvider,
  TtsSessionHandle,
} from './types.js';

const PROVIDER: ProviderName = 'elevenlabs-v3';
const API_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_MODEL = 'eleven_multilingual_v2';
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'; // ElevenLabs public "Bella" voice
const CHUNK_BYTES = 4096;

export const ELEVENLABS_V3_ENV_VARS = ['ELEVENLABS_API_KEY'] as const;

export function isElevenlabsLive(): boolean {
  return readEnv('ELEVENLABS_API_KEY') !== undefined;
}

export function createElevenlabsV3Provider(): TtsProvider {
  return {
    name: PROVIDER,
    async startSession(options: StartSessionOptions): Promise<TtsSessionHandle> {
      const sessionId = `elevenlabs-v3:${options.tenantId}:${options.language}:${Date.now()}`;
      const apiKey = readEnv('ELEVENLABS_API_KEY');
      const queue = new AsyncQueue<PartialAudio>();
      const abortController = new AbortController();

      if (!apiKey) {
        warnOnce(
          'elevenlabs-v3:stub',
          '[elevenlabs-v3] ELEVENLABS_API_KEY missing — using stub session.',
        );
        return createStubHandle(sessionId, options);
      }

      const voiceId =
        options.voiceId ??
        readEnv('ELEVENLABS_DEFAULT_VOICE_ID') ??
        DEFAULT_VOICE_ID;
      const modelId = readEnv('ELEVENLABS_MODEL_TTS') ?? DEFAULT_MODEL;

      return {
        sessionId,
        provider: PROVIDER,
        async speak(text: string) {
          if (abortController.signal.aborted) return;

          const url = `${API_BASE}/${encodeURIComponent(voiceId)}/stream?optimize_streaming_latency=2&output_format=mp3_44100_128`;
          const result = await fetchWithTimeout(url, {
            method: 'POST',
            timeoutMs: DEFAULT_TTS_TOTAL_TIMEOUT_MS,
            externalSignal: abortController.signal,
            headers: {
              accept: 'audio/mpeg',
              'content-type': 'application/json',
              'xi-api-key': apiKey,
            },
            body: JSON.stringify({
              text,
              model_id: modelId,
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
                style: 0.0,
                use_speaker_boost: true,
              },
            }),
          });

          if (!result.ok) {
            queue.fail(
              new Error(`elevenlabs-v3 ${result.providerError}: ${result.bodyText}`),
            );
            return;
          }

          const body = result.response.body;
          if (!body) {
            queue.fail(new Error('elevenlabs-v3: empty response body'));
            return;
          }

          // Stream → 4 KB PartialAudio frames. We deliberately don't decode
          // the MP3 — downstream consumers either re-encode for the call leg
          // or hand the bytes straight to a media gateway.
          const reader = body.getReader();
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) {
                queue.push({
                  sessionId,
                  audio: { bytes: new Uint8Array(0), mimeType: 'audio/opus', sampleRate: 48000 },
                  isFinal: true,
                });
                break;
              }
              for (let i = 0; i < value.byteLength; i += CHUNK_BYTES) {
                const slice = value.slice(i, i + CHUNK_BYTES);
                queue.push({
                  sessionId,
                  audio: { bytes: slice, mimeType: 'audio/opus', sampleRate: 48000 },
                  isFinal: false,
                });
              }
            }
          } catch (error) {
            queue.fail(error);
          }
        },
        audio: () => queue,
        async close() {
          abortController.abort();
          queue.close();
        },
      };
    },
  };
}

function createStubHandle(sessionId: string, _options: StartSessionOptions): TtsSessionHandle {
  async function* audio(): AsyncIterable<PartialAudio> {
    yield {
      sessionId,
      audio: { bytes: new Uint8Array(0), mimeType: 'audio/opus', sampleRate: 48000 },
      isFinal: true,
    };
  }
  return {
    sessionId,
    provider: PROVIDER,
    async speak(_text: string) {
      /* stub */
    },
    audio,
    async close() {
      /* stub */
    },
  };
}

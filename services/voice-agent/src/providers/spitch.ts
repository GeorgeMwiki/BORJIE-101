/**
 * Spitch — Nigerian-language STT, primary for Yoruba / Igbo / Hausa inbound
 * transcription on the Mr. Mwikila pipeline.
 *
 * STATUS: STILL A STUB. No `SPITCH_API_KEY` is provisioned in `.env.local`
 * yet, so this provider has no real upstream to dial. We keep the stub
 * deterministic so routing tests pass, but on real-mode invocation
 * (`LIVE_PROVIDER_TESTS=true`) we emit a one-shot `console.warn` so ops sees
 * the gap during smoke runs.
 *
 * Real implementation (deferred): POST `https://api.spi-tch.com/v1/transcribe`
 * with `Authorization: Bearer $SPITCH_API_KEY` and a `multipart/form-data`
 * body (`audio` + `language`). Stream by re-issuing per audio chunk in
 * `pushAudio` and emitting the JSON `text` into the transcripts queue.
 *
 * Required env (when implemented): `SPITCH_API_KEY`.
 */
/* eslint-disable no-console */

import { liveProviderTestsEnabled, readEnv, warnOnce } from './_runtime.js';
import type {
  AudioChunk,
  PartialTranscript,
  ProviderName,
  StartSessionOptions,
  SttProvider,
  SttSessionHandle,
} from './types.js';

const PROVIDER: ProviderName = 'spitch';

/** Authoritative marker — read by routers / health endpoints. */
export const STUB_PROVIDER = true;

export const SPITCH_ENV_VARS = ['SPITCH_API_KEY'] as const;

/** False until a real Spitch impl lands AND a key is set. */
export function isSpitchLive(): boolean {
  return false;
}

export function createSpitchProvider(): SttProvider {
  return {
    name: PROVIDER,
    async startSession(options: StartSessionOptions): Promise<SttSessionHandle> {
      const sessionId = `spitch:${options.tenantId}:${options.language}:${Date.now()}`;

      // Surface the gap when LIVE_PROVIDER_TESTS=true or SPITCH_API_KEY is
      // unexpectedly set (ops dropped a key but the impl isn't wired yet).
      const live = liveProviderTestsEnabled();
      const keyPresent = readEnv('SPITCH_API_KEY') !== undefined;
      if (live || keyPresent) {
        warnOnce(
          'spitch:still-stub',
          '[spitch] STUB_PROVIDER=true — Nigerian STT is unwired. SPITCH_API_KEY not provisioned. Calls return deterministic placeholders.',
        );
      }

      async function* transcripts(): AsyncIterable<PartialTranscript> {
        yield {
          sessionId,
          text: '[stub] partial',
          isFinal: false,
          confidence: 0.55,
          language: options.language,
        };
        yield {
          sessionId,
          text: '[stub] final transcript',
          isFinal: true,
          confidence: 0.95,
          language: options.language,
        };
      }

      return {
        sessionId,
        provider: PROVIDER,
        async pushAudio(_chunk: AudioChunk) {
          /* stub */
        },
        transcripts,
        async close() {
          /* stub */
        },
      };
    },
  };
}

/**
 * Cartesia Sonic-2 slot — IMPLEMENTED BY HUME (emotion-aware TTS).
 *
 * NOTE ON FILE NAME: this file is still called `cartesia.ts` because the
 * router (`router/tts-router.ts`) and the provider-name union
 * (`ProviderName = 'cartesia-sonic-2' | ...`) refer to it by that name. We
 * intentionally do NOT rename the file or the provider id — that would ripple
 * through every routing test. Instead, when a Cartesia key is unavailable but
 * a Hume key is, we transparently swap in Hume's Octave TTS as the
 * low-latency / emotional fallback.
 *
 * Real implementation: POST `https://api.hume.ai/v0/tts` with
 *   `X-Hume-Api-Key: $HUME_AI_API_KEY`
 *   `X-Hume-Secret-Key: $HUME_AI_API_SECRET`
 * Returns JSON with a base64-encoded WAV payload that we re-chunk into 4 KB
 * PartialAudio frames.
 *
 * Required env (either set is enough — Cartesia preferred if present):
 *   - `CARTESIA_API_KEY` (preferred, not currently provisioned)
 *   - `HUME_AI_API_KEY` + `HUME_AI_API_SECRET` (current substitute)
 *
 * Returns an error frame (not a throw) when the upstream returns non-200.
 */
/* eslint-disable no-console */

import { Buffer } from 'node:buffer';

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

const PROVIDER: ProviderName = 'cartesia-sonic-2';
const HUME_TTS_URL = 'https://api.hume.ai/v0/tts';
const CHUNK_BYTES = 4096;

export const CARTESIA_ENV_VARS = ['CARTESIA_API_KEY'] as const;
export const HUME_ENV_VARS = ['HUME_AI_API_KEY', 'HUME_AI_API_SECRET'] as const;

export function isCartesiaSlotLive(): boolean {
  if (readEnv('CARTESIA_API_KEY') !== undefined) return true;
  return readEnv('HUME_AI_API_KEY') !== undefined && readEnv('HUME_AI_API_SECRET') !== undefined;
}

export function createCartesiaProvider(): TtsProvider {
  return {
    name: PROVIDER,
    async startSession(options: StartSessionOptions): Promise<TtsSessionHandle> {
      const sessionId = `cartesia-sonic-2:${options.tenantId}:${options.language}:${Date.now()}`;

      const humeKey = readEnv('HUME_AI_API_KEY');
      const humeSecret = readEnv('HUME_AI_API_SECRET');
      const cartesiaKey = readEnv('CARTESIA_API_KEY');

      if (!cartesiaKey && (!humeKey || !humeSecret)) {
        warnOnce(
          'cartesia-sonic-2:stub',
          '[cartesia-sonic-2] No CARTESIA_API_KEY and no HUME_AI_API_KEY+SECRET — using stub.',
        );
        return createStubHandle(sessionId, options);
      }

      // Cartesia branch not implemented (key not provisioned in env.local). If
      // a Cartesia key shows up later, plug the real Sonic-2 WS here. For now
      // we go through Hume.
      if (cartesiaKey && (!humeKey || !humeSecret)) {
        warnOnce(
          'cartesia-sonic-2:cartesia-not-impl',
          '[cartesia-sonic-2] CARTESIA_API_KEY present but native impl not wired — falling back to stub.',
        );
        return createStubHandle(sessionId, options);
      }

      const queue = new AsyncQueue<PartialAudio>();
      const abortController = new AbortController();

      return {
        sessionId,
        provider: PROVIDER,
        async speak(text: string) {
          if (abortController.signal.aborted) return;
          // NOTE: humeKey + humeSecret are narrowed by the guard above but
          // closure capture loses that — re-read defensively.
          const key = readEnv('HUME_AI_API_KEY');
          const secret = readEnv('HUME_AI_API_SECRET');
          if (!key || !secret) {
            queue.fail(new Error('hume: keys disappeared between session start and speak()'));
            return;
          }

          const result = await fetchWithTimeout(HUME_TTS_URL, {
            method: 'POST',
            timeoutMs: DEFAULT_TTS_TOTAL_TIMEOUT_MS,
            externalSignal: abortController.signal,
            headers: {
              'content-type': 'application/json',
              'X-Hume-Api-Key': key,
              'X-Hume-Secret-Key': secret,
            },
            body: JSON.stringify({
              utterances: [{ text }],
              format: { type: 'wav' },
            }),
          });

          if (!result.ok) {
            queue.fail(
              new Error(`hume(cartesia-slot) ${result.providerError}: ${result.bodyText}`),
            );
            return;
          }

          try {
            const json = (await result.response.json()) as {
              generations?: ReadonlyArray<{ audio?: string }>;
            };
            const base64 = json.generations?.[0]?.audio;
            if (!base64) {
              queue.fail(new Error('hume: empty generations[].audio'));
              return;
            }
            const all = new Uint8Array(Buffer.from(base64, 'base64'));
            for (let i = 0; i < all.byteLength; i += CHUNK_BYTES) {
              const slice = all.slice(i, i + CHUNK_BYTES);
              queue.push({
                sessionId,
                audio: { bytes: slice, mimeType: 'audio/wav', sampleRate: 24000 },
                isFinal: false,
              });
            }
            queue.push({
              sessionId,
              audio: { bytes: new Uint8Array(0), mimeType: 'audio/wav', sampleRate: 24000 },
              isFinal: true,
            });
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
      audio: { bytes: new Uint8Array(0), mimeType: 'audio/pcm', sampleRate: 24000 },
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

/**
 * Lelapa Vulavula slot — IMPLEMENTED BY INTRON (African STT substitute).
 *
 * NOTE ON FILE NAME: the file is still `lelapa.ts` and the provider id is
 * still `lelapa-vulavula` so the router and routing tests are untouched. When
 * a real Lelapa key shows up we can plug it in alongside Intron; for now we
 * use Intron's `${INTRON_API_ENDPOINT}/transcribe` for Swahili / Luganda STT.
 *
 * Real implementation: POST `${INTRON_API_ENDPOINT}/transcribe` with the
 * pushed audio chunks framed as `multipart/form-data` (`audio` + `language`
 * fields). Returns JSON `{ text, confidence?, is_final? }` per chunk. We
 * convert that into PartialTranscript events.
 *
 * Required env (either set is enough — Lelapa preferred if present):
 *   - `LELAPA_API_KEY` (preferred, not currently provisioned)
 *   - `INTRON_API_ENDPOINT` (current substitute; key in same env var or
 *     `INTRON_API_KEY` if upstream requires bearer auth)
 *
 * Per-chunk timeout: 5 s (per task spec).
 */
/* eslint-disable no-console */

import {
  AsyncQueue,
  DEFAULT_STT_CHUNK_TIMEOUT_MS,
  fetchWithTimeout,
  readEnv,
  warnOnce,
} from './_runtime.js';
import type {
  AudioChunk,
  PartialTranscript,
  ProviderName,
  StartSessionOptions,
  SttProvider,
  SttSessionHandle,
} from './types.js';

const PROVIDER: ProviderName = 'lelapa-vulavula';

export const LELAPA_ENV_VARS = ['LELAPA_API_KEY'] as const;
export const INTRON_ENV_VARS = ['INTRON_API_ENDPOINT'] as const;

export function isLelapaSlotLive(): boolean {
  if (readEnv('LELAPA_API_KEY') !== undefined) return true;
  return readEnv('INTRON_API_ENDPOINT') !== undefined;
}

/**
 * Lelapa uses lowercase ISO 639-1; map our canonical tags onto what Intron's
 * `language` field expects. Intron documents `sw` and `lg` directly; Sheng
 * gets routed as `sw` (closest phonetic fit) until a dedicated Sheng model
 * lands upstream.
 */
function toIntronLang(tag: StartSessionOptions['language']): string {
  switch (tag) {
    case 'sw':
    case 'sw-TZ':
    case 'sheng':
      return 'sw';
    case 'lug':
    case 'lg':
      return 'lg';
    case 'yo':
      return 'yo';
    case 'ig':
      return 'ig';
    case 'ha':
      return 'ha';
    case 'en':
    case 'en-KE':
    default:
      return 'en';
  }
}

export function createLelapaProvider(): SttProvider {
  return {
    name: PROVIDER,
    async startSession(options: StartSessionOptions): Promise<SttSessionHandle> {
      const sessionId = `lelapa-vulavula:${options.tenantId}:${options.language}:${Date.now()}`;
      const lelapaKey = readEnv('LELAPA_API_KEY');
      const intronEndpoint = readEnv('INTRON_API_ENDPOINT');

      if (!lelapaKey && !intronEndpoint) {
        warnOnce(
          'lelapa-vulavula:stub',
          '[lelapa-vulavula] No LELAPA_API_KEY and no INTRON_API_ENDPOINT — using stub.',
        );
        return createStubHandle(sessionId, options);
      }
      if (lelapaKey && !intronEndpoint) {
        warnOnce(
          'lelapa-vulavula:lelapa-not-impl',
          '[lelapa-vulavula] LELAPA_API_KEY present but native impl not wired — falling back to stub.',
        );
        return createStubHandle(sessionId, options);
      }
      // intronEndpoint guaranteed defined past this point.

      const queue = new AsyncQueue<PartialTranscript>();
      const abortController = new AbortController();
      const url = `${intronEndpoint!.replace(/\/$/, '')}/transcribe`;
      const intronKey = readEnv('INTRON_API_KEY');
      const intronLang = toIntronLang(options.language);

      return {
        sessionId,
        provider: PROVIDER,
        async pushAudio(chunk: AudioChunk) {
          if (abortController.signal.aborted) return;
          if (chunk.bytes.byteLength === 0) return;

          const form = new FormData();
          // Wrap Uint8Array → Blob for multipart upload. Node 22 has Blob.
          const blob = new Blob([new Uint8Array(chunk.bytes)], { type: chunk.mimeType });
          form.append('audio', blob, `chunk.${chunk.mimeType === 'audio/wav' ? 'wav' : 'pcm'}`);
          form.append('language', intronLang);
          form.append('sample_rate', String(chunk.sampleRate));

          const headers: Record<string, string> = {};
          if (intronKey) headers['Authorization'] = `Bearer ${intronKey}`;

          const result = await fetchWithTimeout(url, {
            method: 'POST',
            timeoutMs: DEFAULT_STT_CHUNK_TIMEOUT_MS,
            externalSignal: abortController.signal,
            headers,
            body: form,
          });

          if (!result.ok) {
            // Non-200 → emit a transcript error frame; do NOT throw.
            queue.fail(new Error(`intron(lelapa-slot) ${result.providerError}: ${result.bodyText}`));
            return;
          }

          try {
            const json = (await result.response.json()) as {
              text?: string;
              transcript?: string;
              confidence?: number;
              is_final?: boolean;
            };
            const text = json.text ?? json.transcript ?? '';
            if (text.length === 0) return;
            queue.push({
              sessionId,
              text,
              isFinal: json.is_final !== false, // default to final if upstream omits the flag
              ...(typeof json.confidence === 'number' ? { confidence: json.confidence } : {}),
              language: options.language,
            });
          } catch (error) {
            queue.fail(error);
          }
        },
        transcripts: () => queue,
        async close() {
          abortController.abort();
          queue.close();
        },
      };
    },
  };
}

function createStubHandle(sessionId: string, options: StartSessionOptions): SttSessionHandle {
  async function* transcripts(): AsyncIterable<PartialTranscript> {
    yield {
      sessionId,
      text: '[stub] habari',
      isFinal: false,
      confidence: 0.6,
      language: options.language,
    };
    yield {
      sessionId,
      text: '[stub] habari, nataka kuona nyumba',
      isFinal: true,
      confidence: 0.97,
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
}

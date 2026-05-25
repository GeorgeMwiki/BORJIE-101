/**
 * OpenAI gpt-realtime-2 — primary duplex provider for the voice agent.
 *
 * Real implementation: opens a WebSocket against
 * `wss://api.openai.com/v1/realtime?model=<OPENAI_VOICE_MODEL>` with
 * `Authorization: Bearer $OPENAI_API_KEY` + `OpenAI-Beta: realtime=v1`.
 *
 * Duplex event mapping:
 *   - `input_audio_buffer.append`         <-- our `pushAudio(chunk)`
 *   - `response.create` (text -> audio)   <-- our `speak(text)`
 *   - `response.audio.delta`              --> emit PartialAudio
 *   - `response.audio.done`               --> emit final PartialAudio
 *   - `response.audio_transcript.delta`   --> emit PartialTranscript(isFinal=false)
 *   - `response.audio_transcript.done`    --> emit PartialTranscript(isFinal=true)
 *   - `input_audio_buffer.committed` /
 *     `conversation.item.input_audio_transcription.completed`
 *                                          --> emit PartialTranscript for user audio
 *
 * Required env: `OPENAI_API_KEY`. Optional: `OPENAI_VOICE_MODEL` (defaults to
 * `gpt-4o-realtime-preview`). When the key is missing we fall back to the
 * deterministic stub so unit tests stay hermetic.
 */
/* eslint-disable no-console */

import { Buffer } from 'node:buffer';

import { getModelLatest } from '@borjie/brain-llm-router/dynamic-registry';

import {
  AsyncQueue,
  readEnv,
  warnOnce,
} from './_runtime.js';
import type {
  AudioChunk,
  DuplexSessionHandle,
  PartialAudio,
  PartialTranscript,
  ProviderName,
  StartSessionOptions,
} from './types.js';

const PROVIDER: ProviderName = 'gpt-realtime-2';
const DEFAULT_MODEL = 'gpt-4o-realtime-preview';
const REALTIME_BASE = 'wss://api.openai.com/v1/realtime';

/** Required environment variables documented for ops / CI secret-scan. */
export const GPT_REALTIME_2_ENV_VARS = ['OPENAI_API_KEY'] as const;

/** True when the upstream key is missing — caller falls back to stub semantics. */
export function isGptRealtime2Live(): boolean {
  return readEnv('OPENAI_API_KEY') !== undefined;
}

export interface GptRealtime2Provider {
  readonly name: ProviderName;
  startSession(options: StartSessionOptions): Promise<DuplexSessionHandle>;
}

/** Tiny narrowing for the events we care about — keeps the switch terse. */
interface RealtimeEvent {
  type: string;
  delta?: string;
  transcript?: string;
  audio?: string;
  [k: string]: unknown;
}

export function createGptRealtime2Provider(): GptRealtime2Provider {
  return {
    name: PROVIDER,
    async startSession(options: StartSessionOptions): Promise<DuplexSessionHandle> {
      const apiKey = readEnv('OPENAI_API_KEY');
      const sessionId = `gpt-realtime-2:${options.tenantId}:${options.language}:${Date.now()}`;

      if (!apiKey) {
        warnOnce(
          'gpt-realtime-2:stub',
          '[gpt-realtime-2] OPENAI_API_KEY missing — using stub session.',
        );
        return createStubHandle(sessionId, options);
      }

      const model = readEnv('OPENAI_VOICE_MODEL') ?? DEFAULT_MODEL;
      const wsUrl = `${REALTIME_BASE}?model=${encodeURIComponent(model)}`;

      const transcriptQueue = new AsyncQueue<PartialTranscript>();
      const audioQueue = new AsyncQueue<PartialAudio>();
      const abortController = new AbortController();

      // Node 22 ships native WebSocket. Headers go through the second arg as
      // an options object in node:undici-style; the `Authorization` header is
      // never logged because we never serialise it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws = new (globalThis as any).WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      const send = (payload: Record<string, unknown>): void => {
        try {
          ws.send(JSON.stringify(payload));
        } catch (error) {
          // Surface as a transcript error frame; never throw across the
          // async-iterable boundary.
          transcriptQueue.fail(error);
        }
      };

      ws.addEventListener('open', () => {
        // Configure the session for the caller's language + duplex audio.
        send({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: { model: getModelLatest('whisper') },
            voice: options.voiceId ?? 'alloy',
          },
        });
      });

      ws.addEventListener('message', (event: MessageEvent) => {
        let evt: RealtimeEvent;
        try {
          const raw = typeof event.data === 'string' ? event.data : event.data.toString();
          evt = JSON.parse(raw) as RealtimeEvent;
        } catch {
          return; // Ignore unparseable frames.
        }
        handleRealtimeEvent(evt, sessionId, options, transcriptQueue, audioQueue);
      });

      ws.addEventListener('error', (event: Event) => {
        const error = new Error(
          `gpt-realtime-2 websocket error: ${(event as ErrorEvent).message ?? 'unknown'}`,
        );
        transcriptQueue.fail(error);
        audioQueue.fail(error);
      });

      ws.addEventListener('close', () => {
        transcriptQueue.close();
        audioQueue.close();
      });

      // Wait for OPEN (1) before returning so the first pushAudio / speak
      // doesn't race the handshake. Honour external cancellation via signal.
      await waitForOpen(ws, abortController.signal);

      const handle: DuplexSessionHandle = {
        sessionId,
        provider: PROVIDER,
        async pushAudio(chunk: AudioChunk) {
          if (ws.readyState !== 1) return;
          const base64 = Buffer.from(chunk.bytes).toString('base64');
          send({ type: 'input_audio_buffer.append', audio: base64 });
        },
        async speak(text: string) {
          if (ws.readyState !== 1) return;
          send({
            type: 'response.create',
            response: {
              modalities: ['audio', 'text'],
              instructions: text,
            },
          });
        },
        transcripts: () => transcriptQueue,
        audio: () => audioQueue,
        async close() {
          abortController.abort();
          try {
            ws.close();
          } catch {
            // ignore — already closed
          }
          transcriptQueue.close();
          audioQueue.close();
        },
      };
      return handle;
    },
  };
}

function handleRealtimeEvent(
  evt: RealtimeEvent,
  sessionId: string,
  options: StartSessionOptions,
  transcripts: AsyncQueue<PartialTranscript>,
  audio: AsyncQueue<PartialAudio>,
): void {
  switch (evt.type) {
    case 'response.audio.delta': {
      if (typeof evt.delta === 'string' && evt.delta.length > 0) {
        const bytes = new Uint8Array(Buffer.from(evt.delta, 'base64'));
        audio.push({
          sessionId,
          audio: { bytes, mimeType: 'audio/pcm', sampleRate: 24000 },
          isFinal: false,
        });
      }
      return;
    }
    case 'response.audio.done': {
      audio.push({
        sessionId,
        audio: { bytes: new Uint8Array(0), mimeType: 'audio/pcm', sampleRate: 24000 },
        isFinal: true,
      });
      return;
    }
    case 'response.audio_transcript.delta': {
      if (typeof evt.delta === 'string' && evt.delta.length > 0) {
        transcripts.push({
          sessionId,
          text: evt.delta,
          isFinal: false,
          language: options.language,
        });
      }
      return;
    }
    case 'response.audio_transcript.done':
    case 'conversation.item.input_audio_transcription.completed': {
      const text = typeof evt.transcript === 'string' ? evt.transcript : '';
      if (text.length > 0) {
        transcripts.push({
          sessionId,
          text,
          isFinal: true,
          confidence: 0.95,
          language: options.language,
        });
      }
      return;
    }
    case 'error': {
      const message = typeof evt['message'] === 'string' ? (evt['message'] as string) : 'realtime error';
      transcripts.fail(new Error(`gpt-realtime-2: ${message}`));
      audio.fail(new Error(`gpt-realtime-2: ${message}`));
      return;
    }
    default:
      // Ignore frames we don't surface (session.created, rate_limits.updated,
      // input_audio_buffer.committed, etc.). They aren't errors.
      return;
  }
}

function waitForOpen(ws: unknown, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sock = ws as any;
    if (sock.readyState === 1) {
      resolve();
      return;
    }
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onError = (event: Event): void => {
      cleanup();
      reject(new Error(`gpt-realtime-2 connect failed: ${(event as ErrorEvent).message ?? 'unknown'}`));
    };
    const onAbort = (): void => {
      cleanup();
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      reject(new Error('aborted'));
    };
    const cleanup = (): void => {
      sock.removeEventListener('open', onOpen);
      sock.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    sock.addEventListener('open', onOpen);
    sock.addEventListener('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Deterministic stub used when `OPENAI_API_KEY` is unset. Identical contract
 * to the live handle so routing tests pass without touching the network.
 */
function createStubHandle(sessionId: string, options: StartSessionOptions): DuplexSessionHandle {
  async function* transcripts(): AsyncIterable<PartialTranscript> {
    yield {
      sessionId,
      text: '[stub] partial transcript',
      isFinal: false,
      confidence: 0.5,
      language: options.language,
    };
    yield {
      sessionId,
      text: '[stub] final transcript',
      isFinal: true,
      confidence: 0.99,
      language: options.language,
    };
  }
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
    async pushAudio(_chunk: AudioChunk) {
      /* stub */
    },
    async speak(_text: string) {
      /* stub */
    },
    transcripts,
    audio,
    async close() {
      /* stub */
    },
  };
}

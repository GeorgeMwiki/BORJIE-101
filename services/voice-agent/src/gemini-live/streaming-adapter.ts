/**
 * Stateless bridge between Gemini Live's event shape and the voice-agent's
 * shared `PartialTranscript` / `PartialAudio` envelopes.
 *
 * Kept pure-function on purpose: no I/O, no provider construction, no logging.
 * That keeps the unit tests trivial — feed it a Gemini-shaped event, assert
 * the emitted envelope. The client (`gemini-live-client.ts`) owns the
 * AsyncQueue + WebSocket plumbing and calls these functions from its
 * `onmessage` handler.
 *
 * Event-shape reference: Gemini Live BidiGenerateContent server messages
 * carry `serverContent.modelTurn.parts[]` (inline audio under `inlineData`),
 * `serverContent.inputTranscription.text`, `serverContent.outputTranscription.text`,
 * and `serverContent.turnComplete`. See the spec doc §2 for the mapping table.
 */

import { Buffer } from 'node:buffer';

import type {
  LanguageTag,
  PartialAudio,
  PartialTranscript,
} from '../providers/types.js';

/**
 * Narrow shape of the Gemini Live server message envelope. We intentionally
 * model only the fields we consume; everything else is ignored.
 */
export interface GeminiServerEvent {
  readonly serverContent?: {
    readonly modelTurn?: {
      readonly parts?: ReadonlyArray<{
        readonly inlineData?: {
          readonly mimeType?: string;
          readonly data?: string; // base64 PCM
        };
        readonly text?: string;
      }>;
    };
    readonly inputTranscription?: {
      readonly text?: string;
      readonly finished?: boolean;
    };
    readonly outputTranscription?: {
      readonly text?: string;
      readonly finished?: boolean;
    };
    readonly turnComplete?: boolean;
  };
  readonly setupComplete?: Record<string, unknown>;
  readonly error?: { readonly code?: number; readonly message?: string };
}

/**
 * Bundle of envelopes that one server event may emit. A single Gemini frame
 * can carry inline audio + a transcript delta + a turn-complete flag at once,
 * so we return all of them and let the caller push each into its own queue.
 */
export interface AdaptedEvent {
  readonly transcripts: ReadonlyArray<PartialTranscript>;
  readonly audio: ReadonlyArray<PartialAudio>;
  readonly turnComplete: boolean;
  readonly error: Error | null;
}

const EMPTY: AdaptedEvent = Object.freeze({
  transcripts: [],
  audio: [],
  turnComplete: false,
  error: null,
});

/**
 * Translate a single Gemini Live server frame into the shared voice-agent
 * envelopes. Pure function — no side effects, no allocations beyond the
 * returned arrays. Safe to call inside a hot WebSocket message loop.
 */
export function adaptServerEvent(
  event: GeminiServerEvent,
  sessionId: string,
  language: LanguageTag,
): AdaptedEvent {
  if (event.error) {
    const message = event.error.message ?? 'gemini-live error';
    return {
      ...EMPTY,
      error: new Error(`gemini-live: ${message}`),
    };
  }
  if (!event.serverContent) {
    return EMPTY;
  }

  const transcripts: PartialTranscript[] = [];
  const audio: PartialAudio[] = [];

  // Input transcription (what the caller said).
  if (event.serverContent.inputTranscription?.text) {
    transcripts.push({
      sessionId,
      text: event.serverContent.inputTranscription.text,
      isFinal: event.serverContent.inputTranscription.finished === true,
      language,
    });
  }

  // Output transcription (what the agent said — for transcript archival).
  if (event.serverContent.outputTranscription?.text) {
    transcripts.push({
      sessionId,
      text: event.serverContent.outputTranscription.text,
      isFinal: event.serverContent.outputTranscription.finished === true,
      language,
    });
  }

  // Model-turn audio frames (the agent's voice).
  const parts = event.serverContent.modelTurn?.parts ?? [];
  for (const part of parts) {
    const data = part.inlineData?.data;
    if (!data) continue;
    const bytes = new Uint8Array(Buffer.from(data, 'base64'));
    audio.push({
      sessionId,
      audio: { bytes, mimeType: 'audio/pcm', sampleRate: 24000 },
      isFinal: false,
    });
  }

  const turnComplete = event.serverContent.turnComplete === true;
  if (turnComplete) {
    // Emit a final-zero-length audio frame so downstream consumers can flush.
    audio.push({
      sessionId,
      audio: { bytes: new Uint8Array(0), mimeType: 'audio/pcm', sampleRate: 24000 },
      isFinal: true,
    });
  }

  return {
    transcripts,
    audio,
    turnComplete,
    error: null,
  };
}

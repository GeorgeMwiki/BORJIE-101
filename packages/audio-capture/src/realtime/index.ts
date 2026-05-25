/**
 * Realtime bidirectional voice session.
 *
 * Orchestrates: incoming audio → VAD → buffered to user-turn end →
 * STT.streamTranscribe → final transcript → Brain.respond →
 * TTS.streamSynthesize → onSpeak. Tracks first-byte and end-to-end latency
 * per turn. Supports barge-in: if VAD detects speech while TTS is mid-flight,
 * we fire `onInterruption`, stop yielding TTS chunks, and start a new turn.
 *
 * The session is intentionally orchestrator-only — it does not own audio
 * I/O sockets. Consumers (api-gateway, telephony bridges, browsers) wire
 * `send(audio)` and listen on `onSpeak(chunk)` themselves.
 */

import { randomUUID } from 'node:crypto';

import type {
  AudioChunk,
  BrainPort,
  Language,
  RealtimeMetrics,
  RealtimeSession,
  RealtimeSessionOptions,
  TranscriptSegment,
} from '../types.js';
import type { STTPort } from '../stt/index.js';
import type { TTSPort } from '../tts/index.js';
import type { VADPort } from '../vad/index.js';
import type { EnhancementPort } from '../enhancement/index.js';

export interface RealtimeSessionDeps {
  readonly stt: STTPort;
  readonly tts: TTSPort;
  readonly brain: BrainPort;
  readonly vad: VADPort;
  readonly enhancement?: EnhancementPort;
  readonly options?: RealtimeSessionOptions;
  /** Default voice id for synthesized responses. */
  readonly voiceId: string;
}

const DEFAULT_OPTIONS: Required<Omit<RealtimeSessionOptions, 'language'>> & {
  language?: Language;
} = {
  firstByteBudgetMs: 500,
  vadSpeechThreshold: 0.5,
  turnEndSilenceMs: 600,
  allowInterruptions: true,
};

export function createRealtimeSession(
  deps: RealtimeSessionDeps,
): RealtimeSession {
  const sessionId = randomUUID();
  const baseOptions = deps.options ?? {};
  const options = {
    ...DEFAULT_OPTIONS,
    ...baseOptions,
  } satisfies typeof DEFAULT_OPTIONS;

  const transcriptHandlers: Array<(segment: TranscriptSegment) => void> = [];
  const responseHandlers: Array<(text: string) => void> = [];
  const speakHandlers: Array<(chunk: AudioChunk) => void> = [];
  const interruptionHandlers: Array<() => void> = [];

  const metrics: {
    turns: number;
    interruptions: number;
    firstAudioByteLatencyMs: number[];
    endToEndLatencyMs: number[];
  } = {
    turns: 0,
    interruptions: 0,
    firstAudioByteLatencyMs: [],
    endToEndLatencyMs: [],
  };

  let ended = false;
  let activeAudioBuffer: AudioChunk[] = [];
  let consecutiveSilenceMs = 0;
  let activeTurnHadSpeech = false;
  let speakingAbort: AbortController | null = null;

  const emit = <T>(handlers: Array<(arg: T) => void>, arg: T): void => {
    for (const handler of handlers) {
      try {
        handler(arg);
      } catch {
        /* swallow handler errors — orchestrator must keep flowing */
      }
    }
  };

  const emitVoid = (handlers: Array<() => void>): void => {
    for (const handler of handlers) {
      try {
        handler();
      } catch {
        /* swallow */
      }
    }
  };

  const beginTurn = async (chunks: AudioChunk[]): Promise<void> => {
    metrics.turns += 1;
    const turnStart = Date.now();
    const audioIterable = (async function* () {
      for (const chunk of chunks) yield chunk;
    })();

    const sttOptions = options.language
      ? { language: options.language }
      : {};
    let finalText = '';
    for await (const segment of deps.stt.streamTranscribe(
      audioIterable,
      sttOptions,
    )) {
      emit(transcriptHandlers, segment);
      if (segment.isFinal) finalText = segment.text;
    }
    if (!finalText) return;

    const responseText = await deps.brain.respond({
      text: finalText,
      sessionId,
    });
    emit(responseHandlers, responseText);

    speakingAbort = new AbortController();
    const sayStart = Date.now();
    let firstByteSent = false;
    try {
      for await (const audioChunk of deps.tts.streamSynthesize({
        text: responseText,
        voiceId: deps.voiceId,
        format: 'mp3',
      })) {
        if (speakingAbort?.signal.aborted) break;
        if (!firstByteSent) {
          firstByteSent = true;
          metrics.firstAudioByteLatencyMs.push(Date.now() - sayStart);
        }
        emit(speakHandlers, audioChunk);
      }
    } finally {
      speakingAbort = null;
      metrics.endToEndLatencyMs.push(Date.now() - turnStart);
    }
  };

  const send = async (chunk: AudioChunk): Promise<void> => {
    if (ended) return;
    const processedChunk = deps.enhancement
      ? await deps.enhancement.enhance({ audio: chunk, target: 'denoise' })
      : chunk;
    const vadResult = await deps.vad.detect(processedChunk);

    const isSpeech =
      vadResult.isSpeech &&
      vadResult.probability >= options.vadSpeechThreshold;

    // Barge-in: speech while TTS is streaming.
    if (isSpeech && speakingAbort && options.allowInterruptions) {
      metrics.interruptions += 1;
      speakingAbort.abort();
      speakingAbort = null;
      emitVoid(interruptionHandlers);
    }

    if (isSpeech) {
      activeAudioBuffer.push(processedChunk);
      activeTurnHadSpeech = true;
      consecutiveSilenceMs = 0;
      return;
    }

    if (!activeTurnHadSpeech) return;

    consecutiveSilenceMs += chunk.durationMs ?? 100;
    if (consecutiveSilenceMs >= options.turnEndSilenceMs) {
      const turnAudio = activeAudioBuffer.slice();
      activeAudioBuffer = [];
      activeTurnHadSpeech = false;
      consecutiveSilenceMs = 0;
      // Fire and forget — caller can await session.end() to drain.
      void beginTurn(turnAudio);
    }
  };

  const onTranscript = (
    handler: (segment: TranscriptSegment) => void,
  ): (() => void) => {
    transcriptHandlers.push(handler);
    return () => {
      const idx = transcriptHandlers.indexOf(handler);
      if (idx >= 0) transcriptHandlers.splice(idx, 1);
    };
  };

  const onResponse = (handler: (text: string) => void): (() => void) => {
    responseHandlers.push(handler);
    return () => {
      const idx = responseHandlers.indexOf(handler);
      if (idx >= 0) responseHandlers.splice(idx, 1);
    };
  };

  const onSpeak = (handler: (chunk: AudioChunk) => void): (() => void) => {
    speakHandlers.push(handler);
    return () => {
      const idx = speakHandlers.indexOf(handler);
      if (idx >= 0) speakHandlers.splice(idx, 1);
    };
  };

  const onInterruption = (handler: () => void): (() => void) => {
    interruptionHandlers.push(handler);
    return () => {
      const idx = interruptionHandlers.indexOf(handler);
      if (idx >= 0) interruptionHandlers.splice(idx, 1);
    };
  };

  const end = async (): Promise<void> => {
    ended = true;
    if (activeTurnHadSpeech && activeAudioBuffer.length > 0) {
      const turnAudio = activeAudioBuffer.slice();
      activeAudioBuffer = [];
      activeTurnHadSpeech = false;
      await beginTurn(turnAudio);
    }
    if (speakingAbort) {
      speakingAbort.abort();
      speakingAbort = null;
    }
  };

  const snapshot = (): RealtimeMetrics => ({
    turns: metrics.turns,
    interruptions: metrics.interruptions,
    firstAudioByteLatencyMs: [...metrics.firstAudioByteLatencyMs],
    endToEndLatencyMs: [...metrics.endToEndLatencyMs],
  });

  return {
    sessionId,
    send,
    onTranscript,
    onResponse,
    onSpeak,
    onInterruption,
    metrics: snapshot,
    end,
  };
}

/**
 * Deterministic mock STT adapter.
 *
 * Tests inject a fixture transcript and we replay it as either a one-shot
 * result or a series of partial-then-final segments. No network, no timing
 * surprises — useful for unit tests of consumers (turn-taking, persona
 * routing, brain wiring).
 */

import type {
  AudioChunk,
  Language,
  STTRequest,
  STTResult,
  TranscriptSegment,
} from '../types.js';
import type { STTPort } from './index.js';

export interface MockSTTFixture {
  readonly transcript: string;
  readonly language?: Language;
  readonly segments?: ReadonlyArray<TranscriptSegment>;
  readonly partialChunks?: ReadonlyArray<string>;
}

export interface MockSTTOptions {
  readonly fixture: MockSTTFixture;
  readonly modelId?: string;
}

export function createMockSTTAdapter(options: MockSTTOptions): STTPort {
  const modelId = options.modelId ?? 'mock-stt-v1';
  const language = options.fixture.language ?? 'en';

  const transcribe = async (request: STTRequest): Promise<STTResult> => {
    const text = options.fixture.transcript;
    const segments =
      options.fixture.segments ??
      ([
        {
          text,
          startMs: 0,
          endMs: request.audio.durationMs ?? Math.max(text.length * 60, 100),
          confidence: 0.99,
          isFinal: true,
          language: request.language ?? language,
        },
      ] satisfies ReadonlyArray<TranscriptSegment>);

    return {
      transcript: text,
      segments,
      language: request.language ?? language,
      durationMs: segments.length === 0 ? 0 : (segments[segments.length - 1]?.endMs ?? 0),
      modelId,
    };
  };

  const streamTranscribe = async function* (
    audio: AsyncIterable<AudioChunk>,
    streamOptions?: {
      readonly language?: Language;
      readonly diarize?: boolean;
    },
  ): AsyncIterable<TranscriptSegment> {
    // Drain the iterable so producers don't dangle; we ignore the bytes
    // because the fixture is deterministic.
    let chunkCount = 0;
    for await (const _chunk of audio) {
      chunkCount += 1;
      void _chunk;
    }

    const partials = options.fixture.partialChunks ?? null;
    const finalLanguage = streamOptions?.language ?? language;
    if (partials && partials.length > 0) {
      let cursorMs = 0;
      for (const partial of partials) {
        const segmentMs = Math.max(partial.length * 40, 50);
        yield {
          text: partial,
          startMs: cursorMs,
          endMs: cursorMs + segmentMs,
          isFinal: false,
          confidence: 0.7,
          language: finalLanguage,
        };
        cursorMs += segmentMs;
      }
      yield {
        text: options.fixture.transcript,
        startMs: 0,
        endMs: cursorMs,
        isFinal: true,
        confidence: 0.99,
        language: finalLanguage,
      };
      return;
    }

    // No partial fixture — emit one final segment per audio chunk seen.
    yield {
      text: options.fixture.transcript,
      startMs: 0,
      endMs: Math.max(chunkCount * 100, 100),
      isFinal: true,
      confidence: 0.99,
      language: finalLanguage,
    };
  };

  return {
    modelId,
    provider: 'mock',
    transcribe,
    streamTranscribe,
  };
}

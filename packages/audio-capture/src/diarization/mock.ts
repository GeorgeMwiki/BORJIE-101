/**
 * Mock diarization — divides the audio into N equal segments where N is the
 * `expectedSpeakers` (defaulting to 2). Useful for testing consumers that
 * need to assemble speaker-attributed transcripts.
 */

import type { AudioChunk, SpeakerSegment } from '../types.js';
import { pruneUndefined } from '../_internal/bytes.js';
import type { DiarizationPort } from './index.js';

export interface MockDiarizationOptions {
  readonly fixture?: ReadonlyArray<SpeakerSegment>;
}

export function createMockDiarization(
  options: MockDiarizationOptions = {},
): DiarizationPort {
  const fixture = options.fixture ?? null;

  const diarize = async (input: {
    readonly audio: AudioChunk;
    readonly expectedSpeakers?: number;
  }): Promise<ReadonlyArray<SpeakerSegment>> => {
    if (fixture) return fixture;
    const speakers = Math.max(input.expectedSpeakers ?? 2, 1);
    const totalMs = input.audio.durationMs ?? Math.max(input.audio.bytes.byteLength / 32, 1000);
    const segLen = totalMs / speakers;
    const out: SpeakerSegment[] = [];
    for (let i = 0; i < speakers; i += 1) {
      out.push(
        pruneUndefined({
          speakerId: `spk_${i}`,
          startMs: Math.round(i * segLen),
          endMs: Math.round((i + 1) * segLen),
          confidence: 0.9,
        }) as SpeakerSegment,
      );
    }
    return out;
  };

  return { provider: 'mock-diarization', diarize };
}

/**
 * Mock VAD that classifies a deterministic fraction of chunks as speech.
 *
 * Useful for testing realtime session turn-taking: you can craft a sequence
 * of [speech, speech, silence, silence, speech] by passing a custom
 * `pattern` array, or simply set `speechRatio=0.5` and we alternate every
 * other chunk.
 */

import type { AudioChunk, VADResult } from '../types.js';
import { pruneUndefined } from '../_internal/bytes.js';
import type { VADPort } from './index.js';

export interface MockVADOptions {
  readonly speechRatio?: number;
  readonly pattern?: ReadonlyArray<boolean>;
}

export function createMockVAD(options: MockVADOptions = {}): VADPort {
  const ratio = clamp01(options.speechRatio ?? 0.5);
  const pattern = options.pattern ?? null;
  let counter = 0;

  const classify = (chunk: AudioChunk): VADResult => {
    const idx = counter;
    counter += 1;
    let isSpeech: boolean;
    if (pattern && pattern.length > 0) {
      isSpeech = pattern[idx % pattern.length] ?? false;
    } else if (ratio === 0) {
      isSpeech = false;
    } else if (ratio === 1) {
      isSpeech = true;
    } else {
      isSpeech = (idx % Math.max(2, Math.round(1 / ratio))) === 0;
    }
    return pruneUndefined({
      isSpeech,
      probability: isSpeech ? 0.9 : 0.05,
      chunkSequence: chunk.sequence ?? idx,
    }) as VADResult;
  };

  const detect = (chunk: AudioChunk): VADResult => classify(chunk);

  const streamDetect = async function* (
    audio: AsyncIterable<AudioChunk>,
  ): AsyncIterable<VADResult> {
    for await (const chunk of audio) {
      yield classify(chunk);
    }
  };

  return { provider: 'mock-vad', detect, streamDetect };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

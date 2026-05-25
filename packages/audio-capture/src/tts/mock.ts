/**
 * Deterministic mock TTS adapter.
 *
 * Synthesises bytes whose length is proportional to text length so tests can
 * assert latency, chunk count, and round-trip behaviour without hitting the
 * network. Streaming yields N chunks of equal size — the caller can pick
 * `chunkCount` to mimic any vendor's framing cadence.
 */

import type { AudioChunk, TTSRequest, TTSResult } from '../types.js';
import type { TTSPort } from './index.js';

export interface MockTTSOptions {
  readonly bytesPerChar?: number;
  readonly chunkCount?: number;
  readonly modelId?: string;
}

export function createMockTTSAdapter(
  options: MockTTSOptions = {},
): TTSPort {
  const bytesPerChar = options.bytesPerChar ?? 32;
  const chunkCount = Math.max(options.chunkCount ?? 4, 1);
  const modelId = options.modelId ?? 'mock-tts-v1';

  const synthBytes = (text: string): Uint8Array => {
    const total = Math.max(text.length * bytesPerChar, bytesPerChar);
    const out = new Uint8Array(total);
    for (let i = 0; i < total; i += 1) out[i] = (i + text.length) & 0xff;
    return out;
  };

  const synthesize = async (request: TTSRequest): Promise<TTSResult> => {
    const bytes = synthBytes(request.text);
    return {
      audio: {
        bytes,
        format: request.format,
        sampleRate: request.sampleRate ?? 24000,
        channels: 1,
        durationMs: Math.max(request.text.length * 60, 100),
      },
      voiceId: request.voiceId,
      modelId,
      characters: request.text.length,
    };
  };

  const streamSynthesize = async function* (
    request: TTSRequest,
  ): AsyncIterable<AudioChunk> {
    const bytes = synthBytes(request.text);
    const sliceSize = Math.ceil(bytes.byteLength / chunkCount);
    for (let i = 0; i < chunkCount; i += 1) {
      const start = i * sliceSize;
      const end = Math.min(start + sliceSize, bytes.byteLength);
      yield {
        bytes: bytes.subarray(start, end),
        format: request.format,
        sampleRate: request.sampleRate ?? 24000,
        channels: 1,
        sequence: i,
      };
    }
  };

  return { modelId, provider: 'mock', synthesize, streamSynthesize };
}

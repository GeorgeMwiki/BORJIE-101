/**
 * TTS port + adapter exports.
 *
 * Same shape as STT — every vendor exposes `synthesize` (one-shot) and
 * `streamSynthesize` (chunked output for sub-500ms time-to-first-audio).
 */

import type { AudioChunk, TTSRequest, TTSResult } from '../types.js';

export interface TTSPort {
  readonly modelId: string;
  readonly provider: string;
  synthesize(request: TTSRequest): Promise<TTSResult>;
  streamSynthesize(request: TTSRequest): AsyncIterable<AudioChunk>;
}

export { createElevenLabsAdapter } from './elevenlabs.js';
export { createHumeAdapter } from './hume.js';
export { createCartesiaTTSAdapter } from './cartesia.js';
export { createOpenAITTSAdapter } from './openai.js';
export { createMockTTSAdapter } from './mock.js';

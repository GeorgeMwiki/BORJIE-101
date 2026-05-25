/**
 * STT port + adapter exports.
 *
 * Every adapter satisfies the same `STTPort` so the consumer can choose at
 * boot time: Deepgram Nova-3 for English/Swahili broadcast quality, Cartesia
 * Sonic for sub-300ms streaming, Intron for Swahili-first East African, or
 * Whisper.cpp for offline / air-gapped tenants.
 */

import type {
  AudioChunk,
  Language,
  STTRequest,
  STTResult,
  TranscriptSegment,
} from '../types.js';

export interface STTPort {
  readonly modelId: string;
  readonly provider: string;
  transcribe(request: STTRequest): Promise<STTResult>;
  streamTranscribe(
    audio: AsyncIterable<AudioChunk>,
    options?: {
      readonly language?: Language;
      readonly diarize?: boolean;
    },
  ): AsyncIterable<TranscriptSegment>;
}

export { createDeepgramAdapter } from './deepgram.js';
export { createOpenAIRealtimeAdapter } from './openai-realtime.js';
export { createCartesiaAdapter } from './cartesia.js';
export { createIntronAdapter } from './intron.js';
export { createAnthropicVoiceAdapter } from './anthropic-voice.js';
export { createWhisperLocalAdapter } from './whisper-local.js';
export { createMockSTTAdapter } from './mock.js';

/**
 * VAD port + adapters.
 *
 * Three flavours:
 *   - Silero (ONNX, ~200ms per frame, 95%+ accuracy) for batch / background
 *   - WebRTC (lightweight WASM, sub-10ms per 10ms frame) for browser/JS
 *   - Mock (deterministic) for tests
 *
 * The streaming form emits a `VADResult` per chunk; consumers use the
 * boundary transitions (speech → silence or vice versa) to drive turn-taking.
 */

import type { AudioChunk, VADResult } from '../types.js';

export interface VADPort {
  readonly provider: string;
  detect(chunk: AudioChunk): Promise<VADResult> | VADResult;
  streamDetect(audio: AsyncIterable<AudioChunk>): AsyncIterable<VADResult>;
}

export { createSileroVAD } from './silero.js';
export { createWebRTCVAD } from './webrtc.js';
export { createMockVAD } from './mock.js';

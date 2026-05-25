/**
 * Public barrel for @borjie/audio-capture.
 *
 * All ten subsystems are exported here. Consumers either:
 *   1. import specific adapters (`createDeepgramAdapter`, `createElevenLabsAdapter`)
 *      and compose them manually, or
 *   2. call `createAudioCapture({ stt, tts, vad, brain, … })` to get a
 *      ready-to-run bundle including realtime session orchestration.
 */

export * from './types.js';
export * from './stt/index.js';
export * from './tts/index.js';
export * from './vad/index.js';
export * from './diarization/index.js';
export * from './enhancement/index.js';
export * from './codecs/index.js';
export * from './voice-clone/index.js';
export { createRealtimeSession } from './realtime/index.js';
export type { RealtimeSessionDeps } from './realtime/index.js';
export { createAudioCapture } from './factory.js';
export type { AudioCapture, CreateAudioCaptureOptions } from './factory.js';

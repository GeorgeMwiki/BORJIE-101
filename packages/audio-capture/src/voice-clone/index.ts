/**
 * Voice clone port + adapters.
 *
 * Each adapter takes `VoiceCloneRequest` and returns `VoiceClone` metadata
 * describing the resulting reusable voice (its provider-side ID, supported
 * languages, etc.). Synthesis with the clone is then performed by passing
 * `clone.id` to the TTS adapter from the same vendor.
 */

import type { VoiceClone, VoiceCloneRequest } from '../types.js';

export interface VoiceClonePort {
  readonly provider: string;
  createClone(request: VoiceCloneRequest): Promise<VoiceClone>;
}

export { createElevenLabsVoiceLab } from './elevenlabs-voice-lab.js';
export { createOpenAIVoiceEngine } from './openai-voice-engine.js';

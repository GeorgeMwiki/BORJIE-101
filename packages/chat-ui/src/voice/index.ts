/**
 * Voice subsystem barrel.
 *
 * Browser-only — these primitives use Web Speech APIs and assume a
 * `window`. The `useJarvis` hook accepts a `VoiceAudioPort` so other
 * adapters (Whisper, Deepgram, etc.) can drop in later.
 */

export type {
  ListeningHandle,
  SpeakOptions,
  SpeechToTextResult,
  VoiceAudioPort,
  VoiceDescriptor,
} from './voice-audio-port.js';

export {
  createWebSpeechAudioPort,
  type CreateWebSpeechAudioPortOptions,
} from './web-speech-adapter.js';

export { MicButton, type MicButtonProps } from './MicButton.js';

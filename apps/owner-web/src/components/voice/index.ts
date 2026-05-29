/**
 * voice/ — CE-3 hands-free chat surface for owner-web.
 *
 * Exports:
 *   useSpeechRecognition + useSpeechSynthesis — Web Speech API hooks
 *     locked to sw-TZ + en-TZ.
 *   VoiceMicButton — drop-in composer mic with live transcript.
 *   VoicePlayButton — drop-in reply playback button.
 *
 * Companion docs:
 *   Docs/research/CHAT_HANDLES_EVERYTHING_SOTA_2026-05-29.md §4.2
 *   Docs/OPS/VOICE_HANDS_FREE.md (operator runbook)
 */

export {
  useSpeechRecognition,
  type SpeechLang,
  type SpeechRecognitionState,
  type UseSpeechRecognitionResult,
  type RecognitionStatus,
} from './use-speech-recognition';

export {
  useSpeechSynthesis,
  type SpeechSynthesisState,
  type UseSpeechSynthesisResult,
  type TtsStatus,
} from './use-speech-synthesis';

export { VoiceMicButton, type VoiceMicButtonProps } from './VoiceMicButton';
export { VoicePlayButton, type VoicePlayButtonProps } from './VoicePlayButton';

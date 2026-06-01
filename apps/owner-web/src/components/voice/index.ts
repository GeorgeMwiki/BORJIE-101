/**
 * voice/ — CE-3 hands-free chat surface for owner-web.
 *
 * Exports:
 *   useSpeechRecognition + useSpeechSynthesis — Web Speech API hooks
 *     locked to sw-TZ + en-TZ (browser fallback path).
 *   useRealtimeVoice — realtime-duplex client against the gateway voice
 *     WS, with automatic degradation to the browser path.
 *   VoiceMicButton — drop-in composer mic: prefers the realtime duplex
 *     call, falls back to browser STT (BrowserMic / RealtimeMic surfaces).
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
export { BrowserMic, type BrowserMicProps } from './BrowserMic';
export { RealtimeMic, type RealtimeMicProps } from './RealtimeMic';
export { VoicePlayButton, type VoicePlayButtonProps } from './VoicePlayButton';

export {
  useRealtimeVoice,
  type RealtimeVoiceState,
  type RealtimeVoiceStatus,
  type UseRealtimeVoiceArgs,
  type UseRealtimeVoiceResult,
} from './use-realtime-voice';

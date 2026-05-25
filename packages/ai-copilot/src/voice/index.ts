/**
 * Voice AI — Wave 11.
 *
 * ElevenLabs + OpenAI voice providers, a language-aware router, and a
 * conversational session manager.
 */

export * from './types.js';
export { ElevenLabsProvider } from './elevenlabs-provider.js';
export type { ElevenLabsProviderConfig } from './elevenlabs-provider.js';
export { OpenAIVoiceProvider } from './openai-voice-provider.js';
export type { OpenAIVoiceProviderConfig } from './openai-voice-provider.js';
export { createVoiceRouter } from './voice-router.js';
export type { VoiceRouter, VoiceRouterDeps } from './voice-router.js';
export { createVoiceSession } from './voice-session.js';
export type {
  VoiceSession,
  VoiceSessionConfig,
  VoiceSessionHandle,
  VoiceSessionTurnResult,
  LLMResponder,
} from './voice-session.js';

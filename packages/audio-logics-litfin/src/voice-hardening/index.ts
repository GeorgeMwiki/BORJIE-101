/**
 * Voice-hardening subsystem (LP-27).
 *
 *   - adversarial/replay/deepfake classifier + nonce-challenge gate
 *   - bilingual challenge-phrase generator + scorer
 *   - AI-voice disclosure header builder (SB 942 / EU AI Act Art 50)
 *   - AudioSeal acoustic watermark (deterministic LSB fallback + provider hook)
 *   - P95-TTFB TTS auto-failover decision
 *
 * @module @borjie/audio-logics-litfin/voice-hardening
 */

export * from './types.js';

export {
  classifyAdversarialVoice,
  detectDeepfakeLiveness,
  type DeepfakeLivenessInput,
  type DeepfakeLivenessVerdict,
} from './adversarial-classifier.js';

export {
  generateChallengePhrase,
  scoreChallengeResponse,
  type ChallengePhraseOptions,
} from './challenge-phrase.js';

export {
  buildDisclosureHeader,
  getDisclosureBadge,
  normaliseDisclosureLocale,
  type DisclosureLocale,
  type DisclosureHeader,
} from './ai-voice-disclosure.js';

export {
  derivePayloadSha256,
  computeXorChecksum,
  embedWatermark,
  verifyWatermark,
  getWatermarkProvider,
  type WatermarkPayload,
  type VerifyResult,
} from './audioseal-watermark.js';

export {
  decideTtsProvider,
  reduceRecentTtfbP95,
  type TtsFailoverDecision,
  type DecideTtsProviderArgs,
  type TtfbP95Source,
} from './tts-failover.js';

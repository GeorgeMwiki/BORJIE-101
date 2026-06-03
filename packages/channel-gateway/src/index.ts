/**
 * @borjie/channel-gateway — public API (LP-25).
 *
 * Unified inbound ChannelEvent canonicalizer + cross-channel state-sync +
 * an Africa's-Talking IVR->STT adapter. Wire it at the api-gateway
 * composition root by injecting a per-provider signature verifier, a
 * sender->tier resolver, a conversation store, and an SSRF-safe fetch port.
 *
 * @module @borjie/channel-gateway
 */

export * from './types.js';
export * from './ports.js';

export {
  createChannelGateway,
  type ChannelGateway,
  type ChannelGatewayDeps,
  type CanonicalizeInput,
} from './gateway.js';

export {
  canonicalizeByChannel,
  canonicalizeWhatsApp,
  canonicalizeSms,
  canonicalizeUssd,
  canonicalizeVoice,
  canonicalizeEmail,
  canonicalizeWeb,
  normalizePhone,
  type CanonicalDraft,
} from './canonicalizers.js';

export {
  createStateSync,
  type StateSync,
  type StateSyncDeps,
} from './state-sync.js';

export {
  createInMemoryConversationStore,
} from './in-memory-store.js';

export {
  stepIvr,
  transcribeRecording,
  type IvrState,
  type IvrLanguage,
  type IvrInput,
  type IvrStepResponse,
  type IvrSttPort,
  type TranscribeRecordingDeps,
  type TranscribeRecordingResult,
} from './africas-talking-ivr.js';

/**
 * `@borjie/ambient-listener` — public surface (Wave 19J).
 *
 * Mr. Mwikila ambient voice listening. Consent-gated chat/call/SMS
 * awareness pipeline. Aware without being creepy — VAD → diarise →
 * STT → redact → extract → persist. Silent disable on any consent gap.
 *
 * Spec: Docs/DESIGN/AMBIENT_VOICE_LISTENING_SPEC.md.
 * Locked default per Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md
 * — Decisions 3 + 4.
 *
 * This package is PURE — no HTTP, audio, SDK, or database client code.
 * The host wires concrete VAD / diarise / STT / redactor / extractor
 * impls through the package's ports.
 */

// ---------------------------------------------------------------------------
// Types — the public domain surface
// ---------------------------------------------------------------------------
export {
  // Constants
  RE_CONSENT_WINDOW_DAYS,
  OPT_OUT_WINDOW_HOURS,
  KILL_SWITCH_LOOKBACK_HOURS,
  CIRCUIT_BREAKER_THRESHOLD,
  SENTIMENT_MIN,
  SENTIMENT_MAX,
  // Enums
  AMBIENT_CHANNELS,
  CONSENT_STATES,
  KILL_SWITCH_SCOPES,
  INTENT_KINDS,
  ENTITY_KINDS,
  type AmbientChannel,
  type ConsentState,
  type KillSwitchScope,
  type Intent,
  type EntityKind,
  // Domain types
  type AmbientConsent,
  type EntityHit,
  type AmbientCapture,
  type KillSwitchEvent,
  // Pipeline shapes
  type PipelineInput,
  type PipelineOutcome,
  type SilentDisableReason,
  type AudioPayload,
  // Ports
  type VadPort,
  type VadHit,
  type DiarisePort,
  type DiariseSpan,
  type SttPort,
  type SttArgs,
  type SttResult,
  type PiiRedactorPort,
  type PiiRedactArgs,
  type RedactedText,
  type RedactedSpan,
  type IntentExtractorPort,
  type EntityExtractorPort,
  type SentimentExtractorPort,
  // Repo ports
  type AmbientConsentsRepository,
  type AmbientCapturesRepository,
  type KillSwitchEventsRepository,
  // Auxiliary ports
  type AuditChainPort,
  type CognitiveMemoryWriterPort,
  type CognitiveMemoryObserveArgs,
  type MetricsPort,
  // Errors
  AmbientListenerError,
  // Zod
  ambientChannelSchema,
  consentStateSchema,
  killSwitchScopeSchema,
  intentSchema,
  entityKindSchema,
  ambientConsentSchema,
  entityHitSchema,
  ambientCaptureSchema,
  killSwitchEventSchema,
} from './types.js';

// ---------------------------------------------------------------------------
// Consent + kill switch
// ---------------------------------------------------------------------------
export {
  createConsentManager,
  isExpired,
  type ConsentManager,
  type ConsentManagerDeps,
  type GrantArgs,
  type RevokeArgs,
  type CheckArgs,
  type CheckResult,
} from './consent/consent-manager.js';

export {
  createKillSwitch,
  type KillSwitch,
  type KillSwitchDeps,
  type TriggerArgs,
} from './consent/kill-switch.js';

// ---------------------------------------------------------------------------
// VAD + diarisation + STT (port + test impls)
// ---------------------------------------------------------------------------
export {
  createNoopVad,
  createSilentVad,
} from './vad/vad-port.js';

export {
  createSingleSpeakerDiarise,
} from './diarise/diarise-port.js';

export {
  createFixedTranscriptStt,
  createFailingStt,
} from './stt/stt-port.js';

// ---------------------------------------------------------------------------
// Redactor + extractors
// ---------------------------------------------------------------------------
export {
  createPiiRedactor,
  collectMatches,
  stubHasher,
  type Hasher,
  type CreateRedactorDeps,
} from './redact/pii-redactor.js';

export {
  createReferenceIntentExtractor,
  REFERENCE_INTENT_RULES,
} from './extract/intent-extractor.js';

export {
  createReferenceEntityExtractor,
} from './extract/entity-extractor.js';

export {
  createReferenceSentimentExtractor,
  clampSentiment,
} from './extract/sentiment-light.js';

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------
export {
  createListenerPipeline,
  type ListenerPipeline,
  type ListenerPipelineDeps,
} from './pipeline/listener-pipeline.js';

// ---------------------------------------------------------------------------
// Repositories (in-memory reference impls)
// ---------------------------------------------------------------------------
export { createInMemoryAmbientConsentsRepository } from './repositories/ambient-consents.js';
export { createInMemoryAmbientCapturesRepository } from './repositories/ambient-captures.js';
export { createInMemoryKillSwitchEventsRepository } from './repositories/kill-switch-events.js';
export { createInMemoryAuditChain } from './repositories/audit.js';

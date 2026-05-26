/**
 * `@borjie/language-sota` — public surface.
 *
 * Wave 19G. The language abstraction layer underpinning every
 * downstream linguistic capability (swahili-linguistics, translation-
 * sota, ambient-listener, language-self-improve). Six angles:
 * pronunciation, grammar, intonation, code-switching, toggle,
 * translation — see `Docs/DESIGN/LANGUAGE_VOICE_SOTA_SPEC.md`.
 */

// ---------------------------------------------------------------------------
// Types — the public domain surface
// ---------------------------------------------------------------------------
export {
  // Core domain
  LANGUAGES,
  CHANNELS,
  CONSENT_STATES,
  INTONATION_SHAPES,
  LanguageSotaError,
  // Type-only re-exports
  type Language,
  type Channel,
  type ConsentState,
  type Phoneme,
  type IntonationShape,
  type Prosody,
  type CodeSwitchSegment,
  type Utterance,
  type ProviderQuality,
  type GopBaseline,
  type UserLanguageProfile,
  // Provider port
  type ProviderCapability,
  type ProviderPort,
  type SttInput,
  type SttResult,
  type TtsInput,
  type TtsResult,
  type TranslateInput,
  type TranslateResult,
  // Detector ports
  type DetectorPort,
  type DetectorVote,
  // Phoneme + prosody ports
  type PhonemeAlignerPort,
  type ProsodyExtractorPort,
  // Repository ports
  type RecordUtteranceInput,
  type RecordProviderQualityInput,
  type UpsertUserProfileInput,
  type UtteranceRepository,
  type ProviderQualityRepository,
  type UserProfileRepository,
  // Clock port
  type ClockPort,
  // Zod schemas
  phonemeSchema,
  prosodySchema,
  codeSwitchSegmentSchema,
  recordUtteranceInputSchema,
  recordProviderQualityInputSchema,
  upsertUserProfileInputSchema,
} from './types.js';

// ---------------------------------------------------------------------------
// Detection — ensemble + code-switching
// ---------------------------------------------------------------------------
export {
  detectLanguage,
  reduceVotes,
  type DetectLanguageResult,
} from './detection/language-detector.js';

export {
  detectCodeSwitches,
  smoothIslands,
  collapseSegments,
  tokenize,
  SHENG_LEXICON,
  type CodeSwitchResult,
  type PerTokenLanguageVoter,
  type TokenTag,
} from './detection/codeswitch-detector.js';

// ---------------------------------------------------------------------------
// Phoneme — aligner port + baseline builder + PER scorer
// ---------------------------------------------------------------------------
export {
  buildBaseline,
  mergeBaseline,
} from './phoneme/phoneme-aligner.js';

export {
  computePer,
  computePerOverIpa,
  type PerScore,
} from './phoneme/per-scorer.js';

// ---------------------------------------------------------------------------
// Prosody — F0 + intonation analyzer + SSML controller
// ---------------------------------------------------------------------------
export {
  analyseProsody,
  downsampleF0,
  classifyIntonation,
  computeStressBins,
  F0_CONTOUR_BINS,
} from './prosody/prosody-analyzer.js';

export {
  buildSsml,
  escapeXml,
  type SsmlInput,
  type SsmlConfig,
} from './prosody/prosody-controller.js';

// ---------------------------------------------------------------------------
// Providers — registry + quality tracker
// ---------------------------------------------------------------------------
export {
  createProviderRegistry,
  type ProviderRegistry,
} from './providers/provider-registry.js';

export {
  createQualityTracker,
  type QualityTracker,
  type QualityTrackerDeps,
} from './providers/quality-tracker.js';

// ---------------------------------------------------------------------------
// Profile — per-user language preference + pronunciation manager
// ---------------------------------------------------------------------------
export {
  createUserProfileManager,
  type UserProfileManager,
  type UserProfileManagerDeps,
} from './profile/user-profile-manager.js';

// ---------------------------------------------------------------------------
// Repositories — in-memory + SQL shapes
// ---------------------------------------------------------------------------
export {
  createInMemoryUtteranceRepository,
  type InMemoryUtteranceRepoDeps,
  type UtteranceSqlRow,
} from './repositories/utterance-repository.js';

export {
  createInMemoryProviderQualityRepository,
  isRecordProviderQualityInput,
  type InMemoryProviderQualityRepoDeps,
  type ProviderQualitySqlRow,
} from './repositories/provider-quality-repository.js';

export {
  createInMemoryUserProfileRepository,
  isUpsertUserProfileInput,
  type InMemoryUserProfileRepoDeps,
  type UserProfileSqlRow,
} from './repositories/user-profile-repository.js';

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
export {
  GENESIS_HASH,
  computeUtteranceAuditHash,
  computeProviderQualityAuditHash,
  type UtteranceHashInput,
  type ProviderQualityHashInput,
} from './audit/audit-chain-link.js';

/**
 * `@borjie/translation-sota` — public surface.
 *
 * Wave 19I. Bidirectional EN ↔ SW translation runner that preserves
 * mining / regulatory / financial terminology (deterministic glossary
 * lock), code-switched segments (language-ID segmenter), register /
 * formality, and Tanzanian honorifics. 3-tier provider strategy:
 * Claude Opus 4.7 → Gemini 2.5 Pro → NLLB-200 self-host.
 *
 * Spec: Docs/DESIGN/TRANSLATION_SOTA_SPEC.md.
 * Persona: Mr. Mwikila. Brand: Borjie.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  LanguageCode,
  ProviderId,
  GlossaryDomain,
  RegisterLevel,
  JudgeId,
  TranslationRequest,
  TranslationResult,
  ProviderDemotion,
  GlossaryEntry,
  Glossary,
  CodeSwitchTag,
  CodeSwitchSegment,
  RegisterTag,
  ProviderTranslateRequest,
  ProviderTranslateResult,
  ProviderPort,
  TranslationEval,
  ComputeCometPort,
  DomainGlossaryPort,
  TranslationRunRepository,
  GlossaryOverrideRepository,
  TranslationEvalRepository,
} from './types.js';

export { TRANSLATION_CONSTANTS } from './types.js';

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export {
  CLAUDE_PROVIDER_ID,
  buildClaudePrompt,
  createClaudeProvider,
  type ClaudeFetchRequest,
  type ClaudeFetchResponse,
  type ClaudeFetcher,
  type ClaudeMtConfig,
  type ClaudeMtDeps,
} from './providers/claude-mt.js';

export {
  GEMINI_PROVIDER_ID,
  buildGeminiPrompt,
  createGeminiProvider,
  type GeminiFetchRequest,
  type GeminiFetchResponse,
  type GeminiFetcher,
  type GeminiMtConfig,
  type GeminiMtDeps,
} from './providers/gemini-mt.js';

export {
  NLLB_PROVIDER_ID,
  nllbLangCode,
  createNllbProvider,
  type NllbFetchRequest,
  type NllbFetchResponse,
  type NllbFetcher,
  type NllbMtConfig,
  type NllbMtDeps,
} from './providers/nllb-mt.js';

// ---------------------------------------------------------------------------
// Glossary
// ---------------------------------------------------------------------------

export {
  assembleGlossary,
  loadTenantGlossary,
  filterForDirection,
  indexKey,
} from './glossary/glossary-manager.js';

export {
  bindingsToSegments,
  lockTerms,
  unlockTerms,
  verifyTermSurvival,
  type LockResult,
  type PlaceholderBinding,
} from './glossary/term-locker.js';

export {
  HONORIFIC_LEXICON_EN,
  HONORIFIC_LEXICON_SW,
  SEED_MINING_GLOSSARY,
} from './glossary/seed-mining-glossary.js';

// ---------------------------------------------------------------------------
// Code switching
// ---------------------------------------------------------------------------

export {
  recombineSegments,
  segmentCodeSwitch,
} from './codeswitch/segmenter.js';

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

export {
  applyRegister,
  detectRegister,
} from './register/register-mapper.js';

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export {
  bleu,
  corpusBleu,
  type BleuOptions,
  type BleuScore,
} from './evaluation/bleu.js';

export {
  chrf,
  type ChrfOptions,
  type ChrfScore,
} from './evaluation/chrf.js';

export {
  computeTerminologyAdherence,
  type AdherenceResult,
} from './evaluation/terminology-adherence.js';

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export {
  createTranslationRunner,
  type RunTranslationResult,
  type TranslationRunnerDeps,
} from './runner/translation-runner.js';

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export { createInMemoryTranslationRunRepository } from './repositories/translation-runs.js';
export { createInMemoryGlossaryOverrideRepository } from './repositories/glossary-overrides.js';
export { createInMemoryTranslationEvalRepository } from './repositories/translation-evals.js';

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export {
  computeTranslationAuditHash,
  GENESIS_HASH,
} from './audit/audit-chain-link.js';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export {
  TRANSLATION_LOG_LEVELS,
  createLogger,
  DEFAULT_TRANSLATION_TELEMETRY_CONFIG,
  type TranslationLogger,
  type TranslationServiceIdentity,
  type TranslationTelemetryConfig,
  type TranslationLogLevel,
} from './logger.js';

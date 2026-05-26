/**
 * `@borjie/language-self-improve` — public surface.
 *
 * Wave 19K. The continuous improvement loop for Mr. Mwikila's
 * Swahili. Capture → score (4 axes) → curate → train (LoRA / rag-
 * prefix) → eval (200-utterance gauntlet + per-tenant additions) →
 * promote / rollback → emit a Wave 19C RLVR verifier signal.
 *
 * Source of truth: Docs/DESIGN/LANGUAGE_SELF_IMPROVE_SPEC.md.
 */

// ── Types ──────────────────────────────────────────────────────────────────
export {
  DEFAULT_LANGUAGE_SCORE_WEIGHTS,
  DEFAULT_PROMOTION_THRESHOLDS,
  LanguageSelfImproveError,
  type Adapter,
  type AdapterKind,
  type AdapterStatus,
  type Dialect,
  type EvalDelta,
  type EvalRun,
  type ExclusionReason,
  type GauntletEntry,
  type LanguageScore,
  type LanguageScoreWeights,
  type LanguageTag,
  type PromotionDecision,
  type PromotionThresholds,
  type TrainingPair,
  type UtteranceCategory,
} from './types.js';

// ── Scoring ────────────────────────────────────────────────────────────────
export {
  computeWer,
  normaliseForWer,
  scoreWer,
  type WerComputation,
} from './score/wer-scorer.js';

export {
  computePer,
  naiveCodepointPhonemiser,
  scorePer,
  type PerComputation,
  type PhonemiserPort,
} from './score/per-scorer.js';

export {
  naiveSwahiliPort,
  passthroughLlmGrader,
  scoreGrammar,
  type GrammarIssue,
  type GrammarResult,
  type GrammarScorerConfig,
  type LlmGraderPort,
  type SwahiliLinguisticsPort,
} from './score/grammar-scorer.js';

export {
  computeGlossaryAdherence,
  defaultTerminologyPort,
  MINING_GLOSSARY,
  scoreTerminology,
  type GlossaryTerm,
  type TerminologyResult,
  type TranslationSotaPort,
} from './score/terminology-scorer.js';

// ── Curate ─────────────────────────────────────────────────────────────────
export {
  curateExamples,
  DEFAULT_CURATOR_CONFIG,
  type CurationResult,
  type CuratorConfig,
  type CuratorInput,
  type PiiRedactorPort,
} from './curate/example-curator.js';

// ── Adapter ────────────────────────────────────────────────────────────────
export {
  createInMemoryLoraPort,
  type InMemoryLoraConfig,
  type LoraAdapterPort,
  type TrainingJobHandle,
  type TrainingJobReport,
  type TrainingJobStatus,
} from './adapter/lora-adapter-port.js';

export {
  approximateTokenCounter,
  buildRagPrefix,
  DEFAULT_RAG_PREFIX_CONFIG,
  type RagPrefix,
  type RagPrefixConfig,
  type TokenCounterPort,
} from './adapter/rag-prefix-builder.js';

// ── Gauntlet ───────────────────────────────────────────────────────────────
export {
  EXTENDED_GAUNTLET_UTTERANCES,
  EXTENDED_GAUNTLET_VERSION,
  tallyGauntlet,
  type ExtendedGauntletUtterance,
  type GauntletTally,
} from './gauntlet/extended-gauntlet.js';

// ── Eval ───────────────────────────────────────────────────────────────────
export {
  buildEvalRunRow,
  runEvalGauntlet,
  type EvalAggregate,
  type EvalRunPair,
  type EvalRunnerConfig,
  type EvalRunnerPorts,
  type LanguageModelPort,
} from './eval/eval-runner.js';

// ── Decide ─────────────────────────────────────────────────────────────────
export {
  checkSignificance,
  decidePromotion,
  type PromotionDecisionResult,
} from './decide/promotion-decider.js';

// ── Runner ─────────────────────────────────────────────────────────────────
export {
  LORA_PAIR_FLOOR,
  runSelfImprove,
  type SelfImproveRunnerConfig,
  type SelfImproveRunnerPorts,
  type SelfImproveRunResult,
} from './runner/self-improve-runner.js';

// ── Repositories ───────────────────────────────────────────────────────────
export {
  createInMemoryTrainingPairRepository,
  type TrainingPairRepository,
} from './repositories/training-pair-repository.js';

export {
  AdapterTransitionError,
  createInMemoryAdapterRepository,
  type AdapterRepository,
} from './repositories/adapter-repository.js';

export {
  createInMemoryEvalRunRepository,
  type EvalRunRepository,
} from './repositories/eval-run-repository.js';

export {
  createInMemoryGauntletEntryRepository,
  GauntletEntryDuplicateError,
  type GauntletEntryRepository,
} from './repositories/gauntlet-entry-repository.js';

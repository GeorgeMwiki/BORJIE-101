/**
 * `@borjie/cognitive-engine` — public surface.
 *
 * Cognitive Engine: the foundation layer that sits UNDERNEATH all 5
 * atomic capabilities (research / tab / doc / media / campaign). Every
 * `compose_anything_v1` call routes through the engine first.
 *
 * Six disciplines:
 *
 *   1. Deliberate Reasoning by Default     (`reasoning/`)
 *   2. Cite or Stay Silent                  (`grounding/`)
 *   3. Calibrated Uncertainty               (`calibration/`)
 *   4. Interactive Scoping                  (`scoping/`)
 *   5. Relevance Pruning                    (`relevance/`)
 *   6. Adaptive Ingestion                   (`ingest/`)
 *
 * Source of truth: `Docs/DESIGN/COGNITIVE_ENGINE_SPEC.md` (Wave 18T).
 */

// ── Types ──────────────────────────────────────────────────────────────
export {
  CONFIDENCE_LABELS,
  TURN_PATHS,
  SUFFICIENCY_STATES,
  INGEST_KINDS,
  DATA_REQUEST_KINDS,
  SpanCitationSchema,
  CognitiveTurnInputSchema,
  ClarifyingQuestionSchema,
  DataRequestSchema,
  type ConfidenceLabel,
  type TurnPath,
  type SufficiencyState,
  type IngestKind,
  type DataRequestKind,
  type SpanCitation,
  type AttachmentRef,
  type PassiveCaptureSnapshot,
  type UiStateGraph,
  type EvidenceItem,
  type PlanStep,
  type ReasoningTrace,
  type ClarifyingQuestion,
  type DataRequest,
  type ColumnSpec,
  type PiiRedaction,
  type DataJoinRef,
  type AdaptiveIngestResult,
  type CognitiveTurnInput,
  type UncertaintyNote,
  type ArtifactRef,
  type CognitiveTurnOutput,
  type CognitiveLlmPort,
  type IngestStoragePort,
  type TabularParserPort,
  type DocumentParserPort,
  type ClockPort,
  type AuditSinkPort,
} from './types.js';

// ── Reasoning (Discipline 1) ───────────────────────────────────────────
export {
  classifyIntent,
  DEFAULT_INTENT_PATTERNS,
  type IntentClassification,
  type IntentKeywordPattern,
} from './reasoning/intent-classifier.js';

export {
  buildEvidenceInventory,
  type CandidateEvidence,
} from './reasoning/evidence-inventory.js';

export {
  checkSufficiency,
  INTENT_FLOOR,
  type SufficiencyInput,
  type SufficiencyDecision,
} from './reasoning/sufficiency-check.js';

export {
  deliberateReason,
  type DeliberateReasonerInput,
  type DeliberateReasonerDeps,
} from './reasoning/deliberate-reasoner.js';

// ── Grounding (Discipline 2) ───────────────────────────────────────────
export {
  classifyClaim,
  classifySentences,
  extractMarkers,
  splitSentences,
  type Sentence,
  type ClassifiedSentence,
} from './grounding/claim-extractor.js';

export {
  classifySentencesWithLlm,
  type ClaimLlmClient,
  type ClaimLlmRequest,
  type ClaimLlmResponse,
  type ClaimLogger,
  type ClassifySentencesWithLlmOptions,
} from './grounding/claim-extractor-llm.js';

export {
  buildCitationIndex,
  resolveCitations,
  type CitationResolution,
} from './grounding/citation-resolver.js';

export {
  validateCitations,
  REJECT_FAILURE_RATE,
  type Verdict,
  type ValidatedSentence,
  type CiteValidatorResult,
} from './grounding/cite-validator.js';

// ── Calibration (Discipline 3) ─────────────────────────────────────────
export {
  calibrateConfidence,
  reduceTier,
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  RECENCY_WINDOW_DAYS,
  type ConfidenceInput,
  type ConfidenceWeights,
  type ConfidenceThresholds,
  type ConfidenceResult,
} from './calibration/confidence-calibrator.js';

export {
  buildUncertaintyNotes,
  type UncertaintyInput,
} from './calibration/uncertainty-notes-builder.js';

// ── Scoping (Discipline 4) ─────────────────────────────────────────────
export {
  buildQuestion,
  MAX_WORDS_PER_QUESTION,
  DEFAULT_NEW_USER_QUESTIONS,
  InvalidQuestionError,
} from './scoping/question-generator.js';

export {
  buildDataRequest,
  type BuildDataRequestInput,
} from './scoping/data-request-builder.js';

export {
  decideScope,
  MAX_QUESTIONS_PER_TURN,
  type ScoperInput,
  type ScoperPath,
  type ScoperResult,
} from './scoping/interactive-scoper.js';

// ── Relevance (Discipline 5) ───────────────────────────────────────────
export {
  scoreRelevance,
  keywordScore,
  tokenize,
  type ContextItem,
  type ScoredContextItem,
  type EmbeddingSimilarityPort,
} from './relevance/relevance-scorer.js';

export {
  pruneContext,
  DEFAULT_CONTEXT_BUDGET_TOKENS,
  MIN_RELEVANCE_FLOOR,
  type PruneResult,
} from './relevance/context-pruner.js';

// ── Ingest (Discipline 6) ──────────────────────────────────────────────
export { redactPii, type RedactResult } from './ingest/pii-redactor.js';

export {
  inferColumnSpec,
  inferAllColumns,
} from './ingest/column-type-inferer.js';

export {
  buildDataJoinRef,
  type BuildJoinInput,
} from './ingest/data-join-registrar.js';

export {
  ingestExcel,
  ingestCsvViaExcelIngester,
  type IngestExcelInput,
  type IngestExcelDeps,
} from './ingest/excel-ingester.js';

export {
  ingestCsv,
  type IngestCsvInput,
  type IngestCsvDeps,
} from './ingest/csv-ingester.js';

export {
  ingestPdf,
  type IngestPdfInput,
  type IngestPdfDeps,
} from './ingest/pdf-ingester.js';

export {
  ingestImage,
  type IngestImageInput,
  type IngestImageDeps,
} from './ingest/image-ingester.js';

export {
  ingestAudio,
  type IngestAudioInput,
  type IngestAudioDeps,
} from './ingest/audio-ingester.js';

// ── Audit ──────────────────────────────────────────────────────────────
export {
  computeIngestAuditHash,
  computeTurnAuditHash,
  type IngestHashInput,
  type TurnHashInput,
} from './audit/audit-chain-link.js';

// ── Runtime ────────────────────────────────────────────────────────────
export {
  runCognitiveLoop,
  type CognitiveLoopInput,
  type CognitiveLoopDeps,
  type ComposeAnythingDispatcherPort,
} from './runtime/cognitive-loop.js';

export {
  wrapWithCognitiveEngine,
  type WrapInput,
  type WrapDeps,
  type ComposeAnythingDispatcher,
} from './runtime/kernel-integration.js';

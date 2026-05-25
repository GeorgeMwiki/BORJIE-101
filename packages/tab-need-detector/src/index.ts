/**
 * @borjie/tab-need-detector
 *
 * Piece O — Need-Detection Tab Spawning v2.
 *
 * Vision:
 *   1. Observe user behaviour (searches, conversations, doc uploads,
 *      tab events, external triggers).
 *   2. Detect unmet need via signal scoring (NER + intent + half-life
 *      decay frequency thresholds).
 *   3. Propose spawning a relevant tab/module to the user.
 *   4. Personalise layout per user when the tab spawns (sections
 *      ordered by mastery + recency + frustration).
 *
 * Backs migrations 0261-0265.
 *
 * Public surface stays minimal — the package exposes:
 *   * Pure observers (one per signal kind)
 *   * `aggregateSignals` + `filterAboveThreshold`
 *   * `planEmissions` + `validateTransition`
 *   * `decidePersonalization`
 *   * `runCron` / `scanTenant` (with a `NeedDetectorRepository` port)
 *   * Zod schemas + branded types
 */

// Types & schemas
export type {
  AggregatedScore,
  ConversationIntentPayload,
  DensityPreference,
  DetectorStateConfig,
  DetectorStateRow,
  DocUploadPayload,
  ExternalTriggerPayload,
  LayoutOverrideRow,
  ModuleTemplateId,
  NewSignalInput,
  OverrideKind,
  PersonalizationDecision,
  PersonalizationRow,
  ProposalRow,
  ProposalStatus,
  ResolvedDetectorConfig,
  SearchKeywordPayload,
  SignalKind,
  SignalRow,
  TabEventPatternPayload,
} from './types.js';
export {
  conversationIntentPayloadSchema,
  DEFAULT_DETECTOR_CONFIG,
  densityPreferenceSchema,
  detectorStateConfigSchema,
  detectorStateRowSchema,
  docUploadPayloadSchema,
  externalTriggerPayloadSchema,
  layoutOverrideRowSchema,
  MODULE_TEMPLATE_IDS,
  moduleTemplateIdSchema,
  newSignalInputSchema,
  overrideKindSchema,
  personalizationRowSchema,
  proposalRowSchema,
  proposalStatusSchema,
  resolveDetectorConfig,
  searchKeywordPayloadSchema,
  signalKindSchema,
  signalRowSchema,
  tabEventPatternPayloadSchema,
} from './types.js';

// Scoring matrix
export {
  defaultWeightForKind,
  DOC_TYPE_RULES,
  evaluateDocType,
  evaluateExternalTrigger,
  evaluateIntentLabel,
  evaluateNerEntities,
  evaluateSearchQuery,
  evaluateTabEventPattern,
  EXTERNAL_TRIGGER_RULES,
  INTENT_LABEL_RULES,
  NER_ENTITY_RULES,
  SEARCH_KEYWORD_RULES,
  TAB_EVENT_PATTERN_RULES,
  type MatrixHit,
} from './scoring-matrix.js';

// Signal observers
export {
  observeConversation,
  observeDocument,
  observeSearch,
  observeTabEventPattern,
  tokeniseQuery,
  type ConversationEvent,
  type DocumentExtractionEvent,
  type SearchQueryEvent,
  type TabEventPatternEvent,
} from './signal-observers/index.js';

// Aggregator
export {
  aggregateSignals,
  filterAboveThreshold,
  type AggregateSignalsOptions,
} from './signal-aggregator.js';

// Emitter
export {
  planEmissions,
  planExpirations,
  validateTransition,
  type EmitOptions,
  type EmitPlan,
  type EmitPlanEntry,
  type ProposalHistoryEntry,
  type SkippedEntry,
} from './proposal-emitter.js';

// Personalization
export {
  decidePersonalization,
  DEFAULT_PERSONALIZATION_OPTIONS,
  type PersonalizationInput,
  type PersonalizationOptions,
} from './personalization-engine.js';

// Cron orchestrator
export {
  runCron,
  scanTenant,
  type CronRunSummary,
  type CronTenantSummary,
  type NeedDetectorRepository,
  type RunCronOptions,
} from './cron.js';

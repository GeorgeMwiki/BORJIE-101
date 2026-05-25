/**
 * Progressive Intelligence — public surface.
 *
 * BORJIE port of LitFin's progressive-intelligence. Accumulates chat
 * turns, document extracts, form fields, and LPMS imports into a typed
 * AccumulatedEstateContext so every downstream surface can display the
 * current draft with evidence.
 *
 * @module progressive-intelligence
 */

export {
  ContextAccumulatorService,
  createContextAccumulator,
  type SectionId,
} from './context-accumulator.js';
export type {
  AccumulatedEstateContext,
  ContextChangeEvent,
  ContextChangeKind,
  ContextChangeListener,
  PropertyDraft,
  TenantProfileDraft,
  LeaseTermsDraft,
  MaintenanceCaseDraft,
  MigrationBatchDraft,
  RenewalProposalDraft,
  ComplianceNoticeDraft,
  FieldMetadata,
  ReadinessReport,
  SectionReadiness,
  DataSource,
  ConfidenceTier,
} from './types.js';
export {
  extractFromMessage,
  firstMatch,
  type PatternMatch,
  type PatternKind,
  type ExtractionOptions,
} from './extraction-patterns.js';
export {
  FIELD_MAPPINGS,
  SECTION_REQUIRED_FIELDS,
  MAINTENANCE_KEYWORD_MAP,
  inferMaintenanceCategory,
  findBestMapping,
  getAffectedSections,
  type FieldMapping,
} from './field-mappings.js';
export type { ValidationReport, ValidationError } from './validation/index.js';
export {
  PropertyDraftSchema,
  TenantProfileDraftSchema,
  LeaseTermsDraftSchema,
  MaintenanceCaseDraftSchema,
  MigrationBatchDraftSchema,
  RenewalProposalDraftSchema,
  ComplianceNoticeDraftSchema,
  assertLeaseCommitReady,
  assertMaintenanceCommitReady,
  assertComplianceNoticeCommitReady,
  validateAccumulatedContext,
} from './validation/index.js';
export {
  VersionHistoryService,
  createVersionHistoryService,
  InMemoryVersionHistoryRepository,
  type ContextSnapshot,
  type VersionHistoryRepository,
} from './version-history.js';
export {
  DynamicSectionManager,
  createDynamicSectionManager,
  DEFAULT_SECTION_GATES,
  type SectionGate,
  type UnlockState,
} from './dynamic-section-manager.js';
export {
  ResearchService,
  createResearchService,
  InMemoryResearchClient,
  type ResearchClient,
  type ResearchRecord,
  type MarketRentBenchmark,
  type DistrictVacancy,
} from './research-service.js';
export {
  ResearchTriggerHub,
  createResearchTriggerHub,
  DEFAULT_TRIGGERS,
  type ResearchTrigger,
  type TriggerId,
} from './research-triggers.js';
export {
  AutoGenerationService,
  createAutoGenerationService,
  type AutoGenerationInput,
  type GenerationPreview,
  type LpmsRow,
  type MigrationWriter,
} from './auto-generation-service.js';
export {
  evaluateTeachingHints,
  renderTeachingHintsAsPromptSegment,
  type TeachingHint,
  type TeachingHintId,
  type TeachingEvaluator,
} from './teaching/index.js';

// Persistent memory layer (migration 0181) — Drizzle-backed adapter
// for the `MemoryBlockStore` port. Wired by the api-gateway composition
// root and shared by every progressive-intelligence surface that needs
// to read or write Letta-style per-session blocks.
export {
  PostgresMemoryBlockStore,
  type IdGenerator,
  type MemoryBlockDbPort,
} from './postgres-memory-block-store.js';
export type {
  MemoryBlock,
  MemoryBlockStore,
  MemoryBlockUpsert,
} from './memory-block-port.js';

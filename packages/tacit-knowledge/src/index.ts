/**
 * `@borjie/tacit-knowledge` — public surface.
 *
 * Wave HARVEST. The 5-mode tacit-knowledge interview engine.
 * Mr. Mwikila walks the floor, sits down after incidents, rides
 * along, replays deals, and silently observes cross-role teaching —
 * and the unwritten know-how lands as consolidated cells in the
 * cognitive-memory store.
 *
 * Spec: `Docs/DESIGN/TACIT_KNOWLEDGE_HARVEST_SPEC.md`.
 * Persona: Mr. Mwikila (Managing Director). Brand: Borjie.
 */

// ---------------------------------------------------------------------------
// Types + constants + Zod schemas
// ---------------------------------------------------------------------------

export type {
  AppendTurnInput,
  CognitiveMemoryObserveInput,
  CognitiveMemoryReinforceInput,
  CognitiveMemorySink,
  CompleteInterviewInput,
  Consent,
  ConsentStatus,
  EntityExtractor,
  EntityKind,
  Extraction,
  ExtractionDraft,
  ExtractionEntity,
  GeoPoint,
  Interview,
  InterviewMode,
  InterviewStatus,
  StartInterviewInput,
  TacitConsentRepository,
  TacitExtractionRepository,
  TacitInterviewRepository,
  TranscriptTurn,
  VectorIndex,
} from './types.js';

export {
  CONSENT_STATUSES,
  ENTITY_KINDS,
  INTERVIEW_MODES,
  INTERVIEW_STATUSES,
  REDUNDANCY_COSINE_THRESHOLD,
  REDUNDANCY_LEXICAL_THRESHOLD,
  REINFORCE_CONFIDENCE_DELTA,
  TacitKnowledgeError,
  appendTurnInputSchema,
  consentStatusSchema,
  entityKindSchema,
  geoPointSchema,
  interviewModeSchema,
  interviewStatusSchema,
  startInterviewInputSchema,
  transcriptTurnSchema,
} from './types.js';

// ---------------------------------------------------------------------------
// Modes — five session templates
// ---------------------------------------------------------------------------

export type {
  DensityTarget,
  ModeTemplate,
  PacingBudget,
} from './modes/mode-shape.js';
export { freezeTemplate } from './modes/mode-shape.js';

export { walkTheFloorTemplate } from './modes/walk-the-floor.js';
export { postIncidentTemplate } from './modes/post-incident.js';
export { rideAlongTemplate } from './modes/ride-along.js';
export { dealReplayTemplate } from './modes/deal-replay.js';
export { crossRoleTemplate } from './modes/cross-role.js';

export {
  getModeTemplate,
  listModeTemplates,
} from './modes/mode-registry.js';

// ---------------------------------------------------------------------------
// Repositories — in-memory + SQL adapters
// ---------------------------------------------------------------------------

export { createInMemoryTacitInterviewRepository } from './repositories/interview-repository-memory.js';
export { createInMemoryTacitExtractionRepository } from './repositories/extraction-repository-memory.js';
export { createInMemoryTacitConsentRepository } from './repositories/consent-repository-memory.js';

export { createSqlTacitInterviewRepository } from './repositories/interview-repository-sql.js';
export { createSqlTacitExtractionRepository } from './repositories/extraction-repository-sql.js';
export { createSqlTacitConsentRepository } from './repositories/consent-repository-sql.js';

export type { SqlRunner } from './repositories/sql-runner.js';

// ---------------------------------------------------------------------------
// Consent manager
// ---------------------------------------------------------------------------

export {
  createConsentManager,
  type ConsentManager,
} from './consent/consent-manager.js';

// ---------------------------------------------------------------------------
// Extractor — reference impl + port
// ---------------------------------------------------------------------------

export { createReferenceEntityExtractor } from './extractor/entity-extractor.js';

// ---------------------------------------------------------------------------
// Consolidator — redundancy checker, cell writer, vector index
// ---------------------------------------------------------------------------

export {
  createRedundancyChecker,
  jaccardSimilarity,
  type RedundancyChecker,
  type RedundancyDecision,
} from './consolidator/redundancy-checker.js';

export {
  createInMemoryVectorIndex,
  cosineSimilarity,
  projectText,
  type InMemoryVectorIndex,
} from './consolidator/in-memory-vector-index.js';

export {
  createCellWriter,
  type CellWriter,
} from './consolidator/cell-writer.js';

export {
  createInMemoryCognitiveMemorySink,
  type InMemoryCognitiveMemorySink,
} from './consolidator/in-memory-cognitive-memory-sink.js';

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export {
  createInterviewEngine,
  DEFAULT_CHUNK_SIZE,
  type InterviewEngine,
  type InterviewEngineDeps,
  type EngineTurnResult,
} from './engine/interview-engine.js';

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export {
  computeTacitAuditHash,
  GENESIS_HASH,
} from './audit/audit-chain-link.js';

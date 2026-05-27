/**
 * `@borjie/blackboard-intel` — public surface.
 *
 * Wave BLACKBOARD-INTEL. Wires blackboard posts into the self-
 * improving loop (three-axis quality scoring + capability-catalogue
 * registration + meta-learning-conductor feedback) and adds hybrid
 * (FTS + dense + RRF) search across the entire blackboard posting
 * history.
 *
 * Persona: Mr. Mwikila (Managing Director). Brand: Borjie.
 * Spec: `Docs/DESIGN/BLACKBOARD_INTEL_SOTA_2026.md`.
 * Migration: `0074_blackboard_intel.sql`.
 *
 * @module @borjie/blackboard-intel
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export {
  BLACKBOARD_CAPABILITY_KINDS,
  QUALITY_AXES,
  DEFAULT_HYBRID_CONFIG,
  EMBEDDING_DIM,
  BlackboardIntelError,
  type AuditChainPort,
  type BlackboardCapabilityAuthor,
  type BlackboardCapabilityKind,
  type BlackboardCorePort,
  type BlackboardIntelErrorCode,
  type BlackboardPostRef,
  type BlackboardRawTrace,
  type CapabilityRegistryPort,
  type ClockPort,
  type DenseSearchIndexPort,
  type EmbeddingPort,
  type HybridRetrievalConfig,
  type Logger,
  type MeasurementWrapperPort,
  type PostQualityScore,
  type PostQualityScoresRepository,
  type QualityAxis,
  type SearchFilters,
  type SearchIndexRepository,
  type SearchQuery,
  type SearchResult,
  type UuidPort,
} from './types.js';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export {
  buildBlackboardIntelLogger,
  type BlackboardIntelLoggerOptions,
} from './logger.js';

// ---------------------------------------------------------------------------
// Measurement — three quality axes
// ---------------------------------------------------------------------------

export {
  measureGroundedness,
  type GroundednessInput,
  type GroundednessResult,
} from './measure/groundedness-scorer.js';
export {
  measureCalibration,
  DEFAULT_HEDGE_MARKERS,
  DEFAULT_CONTRADICTION_MARKERS,
  type CalibrationInput,
  type CalibrationResult,
} from './measure/calibration-scorer.js';
export {
  measureUtility,
  type UtilityInput,
  type UtilityResult,
} from './measure/utility-scorer.js';
export {
  AXIS_ORDER,
  createPostMeasurer,
  tipPerAxisOver,
  wrapKsInvocationAsMeasured,
  type PostMeasurer,
  type PostMeasurerDeps,
} from './measure/post-measurer.js';

// ---------------------------------------------------------------------------
// Capability registration
// ---------------------------------------------------------------------------

export {
  capabilityNameFor,
  createInMemoryCapabilityRegistryPort,
  lookupBlackboardCapabilityId,
  registerBlackboardCapabilities,
  type RegisteredBlackboardCapability,
} from './capability/register-blackboard-capabilities.js';

// ---------------------------------------------------------------------------
// Feedback — meta-curator
// ---------------------------------------------------------------------------

export {
  createMetaCurator,
  tipPerAxisFromRows,
  type MetaCurator,
  type MetaCuratorDeps,
} from './feedback/meta-curator.js';

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export {
  createFtsSearcher,
  snippetOf,
  type FtsSearcher,
  type FtsSearcherDeps,
} from './search/fts-search.js';
export {
  createDenseSearcher,
  type DenseSearcher,
  type DenseSearcherDeps,
} from './search/dense-search.js';
export {
  buildHybridSearcher,
  createHybridSearcher,
  reciprocalRankFusion,
  type HybridSearcher,
  type HybridSearcherDeps,
} from './search/hybrid-search.js';
export {
  applyFiltersInMemory,
  buildWhere,
  type CompiledFilter,
  type InMemoryFilterableRow,
} from './search/filter-builder.js';

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export {
  computeScoreAuditHash,
  createDefaultAuditChainPort,
  verifyScoreChain,
} from './audit/post-audit-chain.js';

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export {
  createInMemoryPostQualityScoresRepository,
  createSqlPostQualityScoresRepository,
  type PostQualityScoresSqlDriver,
} from './repositories/post-quality-scores-repository.js';
export {
  cosineSimilarity,
  createDeterministicEmbeddingPort,
  createInMemoryDenseSearchIndex,
  createInMemorySearchIndexRepository,
  createSqlSearchIndexRepository,
  rankCoverage,
  tokenise,
  type SearchIndexSqlDriver,
} from './repositories/search-index-repository.js';

// ---------------------------------------------------------------------------
// Test fixtures (exported for downstream-package tests + verification)
// ---------------------------------------------------------------------------

export {
  EXPECTED_RRF_ORDER,
  EXPECTED_RRF_SCORES,
  REFERENCE_DENSE_LIST,
  REFERENCE_FTS_LIST,
} from './__fixtures__/rrf-reference-cormack-2009.js';
export {
  V_A,
  V_A_NEAR,
  V_B,
  V_C,
  createConstantEmbeddingPort,
  createFixtureEmbeddingPort,
  pad1536,
} from './__fixtures__/deterministic-embeddings.js';
export {
  createInMemoryBlackboardCore,
  type InMemoryBlackboardCore,
} from './__fixtures__/in-memory-blackboard-core.js';

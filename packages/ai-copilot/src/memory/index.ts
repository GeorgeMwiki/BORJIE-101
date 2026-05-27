/**
 * BORJIE AI memory module — Wave-11.
 *
 * Semantic memory + rule-based extraction + exponential decay sweep.
 */

export {
  createSemanticMemory,
  createInMemorySemanticMemoryRepo,
  createHashEmbedder,
  createDrizzlePersonLayerClient,
  cosineSimilarity,
  PERSON_LAYER_CROSS_TENANT_PENALTY,
  type SemanticMemory,
  type SemanticMemoryRepository,
  type SemanticMemoryRow,
  type SemanticMemoryDeps,
  type RememberInput,
  type RecallResult,
  type RecallOptions,
  type PersonLayerClient,
  type Embedder,
  type MemoryType,
} from './semantic-memory.js';

export {
  extractInsightsFromTurn,
  analyzeAndRemember,
  type ConversationTurn,
  type ExtractedInsight,
  type ExtractorDeps,
} from './memory-extractor.js';

export {
  computeDecayedScore,
  sweepTenantDecay,
  DEFAULT_DECAY,
  type DecayPolicy,
  type DecaySweepDeps,
  type DecayResult,
} from './memory-decay.js';

// Mem0 ADD/UPDATE/DELETE/NOOP semantics (Park et al. 2024). Ported
// from LITFIN — pure decision module used by the consolidation
// worker's promote stage to avoid double-writing contradicted or
// duplicated facts. See ./mem0-semantics.ts header.
export {
  decideMem0Op,
  describeMem0Decision,
  jaccardSimilarity,
  cosineSimilarity as mem0CosineSimilarity,
  withEmbedding as withMem0Embedding,
  DEFAULT_CONTRADICTION_THRESHOLD as MEM0_DEFAULT_CONTRADICTION_THRESHOLD,
  DEFAULT_NOOP_THRESHOLD as MEM0_DEFAULT_NOOP_THRESHOLD,
  DEFAULT_DELETE_THRESHOLD as MEM0_DEFAULT_DELETE_THRESHOLD,
  type FactType as Mem0FactType,
  type Mem0Decision,
  type Mem0Candidate,
  type Mem0ExistingFact,
  type DecideMem0Options,
  type Mem0Embedder,
} from './mem0-semantics.js';

// PersonLayer — federated personal-memory loader + upsert.
// Companion to Docs/research/unified-personal-kb.md §10 + migration
// 0088 + packages/database/src/schemas/personal-memory.schema.ts.
export {
  loadPersonLayer,
  upsertPersonalFact,
  flattenPersonLayer,
  PERSON_CELL_KINDS,
  PERSON_LAYER_PER_KIND_LIMIT,
  type PersonalMemoryCell,
  type PersonCellKind,
  type PersonLayerResult,
  type PersonLayerDrizzleClient,
  type PersonLayerSqlTemplate,
  type LoadPersonLayerArgs,
  type UpsertPersonalFactArgs,
} from './person-layer.js';

// Chinese-wall boundary tagger — pure rules engine sitting between
// PersonLayer and the reply composer. Enforces "counts ok, specifics
// not" + k=3 anonymity per Docs/research/unified-personal-kb.md §3.3.
export {
  enforceChineseWall,
  tagBoundary,
  cellContainsNumeric,
  K_ANONYMITY_FLOOR,
  type EnforceChineseWallArgs,
  type EnforceChineseWallResult,
  type TagBoundaryArgs,
  type BoundaryTags,
  type CrossTenantCount,
} from './boundary-tagger.js';

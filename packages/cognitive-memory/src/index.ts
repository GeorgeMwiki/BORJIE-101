/**
 * `@borjie/cognitive-memory` — public surface.
 *
 * Unified Cognitive Memory (Wave 18AA). The single shared semantic
 * memory substrate that turns Mr. Mwikila and his 27+ specialisations
 * into ONE mind. Spec: docs/DESIGN/UNIFIED_COGNITIVE_MEMORY_SPEC.md.
 *
 * Five operations form the entire API:
 *
 *   - observe     — record a new memory cell
 *   - reinforce   — confirm an existing cell from a different turn
 *   - recall      — semantic search the shared store
 *   - cite        — link a cell into a composed artifact
 *   - contradict  — mark a cell as contradicted; observe the new evidence
 *
 * Every operation goes through `@borjie/audit-hash-chain`. There is no
 * out-of-band write path.
 */

// ---------------------------------------------------------------------------
// Types — the public domain surface
// ---------------------------------------------------------------------------
export {
  // Core domain
  type CognitiveMemoryCell,
  type MemoryContent,
  type MemoryKind,
  type MemoryStatus,
  type MemoryScope,
  type SpanCitation,
  // Query + result
  type MemoryQuery,
  type RecallResult,
  // Operation inputs + contexts
  type MemoryWriteContext,
  type ObserveInput,
  type ReinforceInput,
  type CiteInput,
  type ContradictInput,
  // Federated platform memory
  type PlatformMemoryCell,
  // Ports — swap these to wire production persistence
  type CellRepository,
  type ReinforcementRepository,
  type PlatformCellRepository,
  type EmbeddingService,
  type AuditChainPort,
  // Error + thresholds
  CognitiveMemoryError,
  MEMORY_KINDS,
  MEMORY_STATUSES,
  REINFORCE_PROMOTION_THRESHOLD,
  CONSOLIDATE_RECALL_THRESHOLD,
  CONSOLIDATE_ELAPSED_DAYS,
  DECAY_IDLE_DAYS,
  CONTRADICT_EVIDENCE_THRESHOLD,
  FEDERATION_TENANT_THRESHOLD,
  FEDERATION_SIMILARITY_THRESHOLD,
  EMBEDDING_DIM,
  // Zod schemas (for callers validating untyped wire data)
  observeInputSchema,
  reinforceInputSchema,
  citeInputSchema,
  contradictInputSchema,
  memoryQuerySchema,
} from './types.js';

// ---------------------------------------------------------------------------
// Operations — the only mutation surface
// ---------------------------------------------------------------------------
export { createObserve, type ObserveFn } from './operations/observe.js';
export { createReinforce, type ReinforceFn } from './operations/reinforce.js';
export { createRecall, type RecallFn } from './operations/recall.js';
export { createCite, type CiteFn } from './operations/cite.js';
export {
  createContradict,
  type ContradictFn,
  type ContradictResult,
} from './operations/contradict.js';

// ---------------------------------------------------------------------------
// Promotion lifecycle (pure functions)
// ---------------------------------------------------------------------------
export {
  isContradictionPlausible,
  nextPromotion,
  shouldDecay,
  shouldPromoteToConsolidated,
  shouldPromoteToReinforced,
  type PromotionDecision,
} from './promotion/promotion-decider.js';
export { promotionApply } from './promotion/internal-apply.js';

// ---------------------------------------------------------------------------
// Storage — reference in-memory implementations
// ---------------------------------------------------------------------------
export {
  createInMemoryCellRepository,
  cosineSimilarity,
} from './storage/cell-repository.js';
export { createInMemoryReinforcementRepository } from './storage/reinforcement-repository.js';
export { createInMemoryPlatformCellRepository } from './storage/platform-cell-repository.js';

// ---------------------------------------------------------------------------
// Embedding service
// ---------------------------------------------------------------------------
export {
  createEmbeddingService,
  type UpstreamEmbedder,
  type EmbeddingBudgetGate,
  type EmbeddingServiceOptions,
} from './embedding/embedding-service.js';
export {
  createEmbeddingCache,
  canonicalizeForCache,
  type CachePort,
  type EmbeddingCache,
  type EmbeddingCacheOptions,
} from './embedding/embedding-cache.js';

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
export {
  createInMemoryAuditChain,
  appendMemoryAudit,
} from './audit/audit-chain-link.js';

// ---------------------------------------------------------------------------
// Boundary tagger — Chinese-wall filter for person-layer / tenant-layer
// composition. Drops cross-tenant chunks + blocks cross-tenant numeric
// synthesis at reply-composition time. Spec:
// Docs/RESEARCH/unified-personal-kb.md §3.3 + §5 + §10.6.
// ---------------------------------------------------------------------------
export {
  type ChunkOrigin,
  type TaggedChunk,
  type ActiveContext,
  type CrossTenantSynthesisCheck,
  type KAnonymisedCount,
  filterByActiveContext,
  extractCandidateNumbers,
  checkCrossTenantNumericSynthesis,
  assertNoCrossTenantNumeric,
  CrossTenantNumericSynthesisError,
  kAnonymisedCount,
  DEFAULT_K_ANONYMITY,
} from './boundary-tagger.js';

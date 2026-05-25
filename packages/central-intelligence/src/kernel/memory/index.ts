/**
 * Kernel memory — public barrel.
 *
 * Two layers live behind this entry point:
 *
 *   1. The legacy four-tier hierarchy (`types.ts`) — episodic /
 *      semantic / procedural / reflective ports the kernel has used
 *      since migration 0121. Drizzle adapters live in
 *      `@borjie/database/services/kernel-memory-*`.
 *
 *   2. The persistent memory layer added by migration 0181:
 *      `memory_blocks`, `episodic_notes`, and `anchor_summaries`.
 *      Five modules implement the read / write / fuse / summarise /
 *      evict path: `episodic-amem`, `hybrid-retrieval`,
 *      `anchored-summary`, `eviction`, and the shared port types in
 *      `types-amem`.
 */

// ── Legacy hierarchy ports ───────────────────────────────────────────
export type {
  EpisodicEntry,
  EpisodicKind,
  EpisodicMemoryPort,
  EpisodicRecallArgs,
  EpisodicRecordArgs,
  MemoryHierarchy,
  ProceduralMatchArgs,
  ProceduralMemoryPort,
  ProceduralPattern,
  ProceduralRecordArgs,
  ReflectiveDigest,
  ReflectiveDigestInput,
  ReflectiveLatestArgs,
  ReflectiveMemoryPort,
  ReflectivePeriodKind,
  ReflectiveTopicCount,
  SemanticDecayArgs,
  SemanticFact,
  SemanticFactWithSimilarity,
  SemanticLookupArgs,
  SemanticMemoryPort,
  SemanticSearchArgs,
  SemanticSearchByEmbeddingArgs,
  SemanticSource,
  SemanticUpsertArgs,
} from './types.js';

// ── Persistent memory layer (migration 0181) — port types ────────────
export type {
  AnchorSummary,
  AnchorSummaryInsert,
  AnchorSummaryRepo,
  EpisodicBumpArgs,
  EpisodicCandidateQuery,
  EpisodicEmbeddingQuery,
  EpisodicEvent,
  EpisodicNote,
  EpisodicRepo,
  EpisodicSweepResult,
  HybridRetrievalRepo,
  LLMPort,
  MemoryBlock,
  MemoryBlockStore,
  MemoryBlockUpsert,
  RetrievalCandidate,
} from './types-amem.js';

// ── A-Mem episodic writer + recall ──────────────────────────────────
export {
  PARENT_LINK_COSINE_THRESHOLD,
  computeImportance,
  containsMoney,
  cosineSimilarity,
  recall,
  writeNote,
} from './episodic-amem.js';

// ── Hybrid retrieval (BM25 + vector RRF fusion) ─────────────────────
export {
  DEFAULT_TOP_N,
  PER_SOURCE_LIMIT,
  RRF_K,
  buildRetrievedContext,
  reciprocalRankFusion,
  type DriftObserver,
  type FusedEntry,
} from './hybrid-retrieval.js';

// ── MMR rerank (Maximal Marginal Relevance) ─────────────────────────
export {
  DEFAULT_MMR_LAMBDA,
  DEFAULT_MMR_TOP_K,
  mmrRerank,
  type MmrCandidate,
} from './mmr-rerank.js';

// ── Per-tenant query-embedding drift detector ───────────────────────
export {
  DRIFT_SIGMA_THRESHOLD,
  DriftDetector,
  RING_BUFFER_SIZE,
  type DriftPersistencePort,
  type DriftSignal,
  type DriftStateSnapshot,
} from './drift-detector.js';

// ── Anchored summarisation (70% budget threshold) ───────────────────
export {
  DEFAULT_BUDGET_THRESHOLD,
  DEFAULT_RETAIN_TAIL_FRACTION,
  DEFAULT_SUMMARY_MAX_TOKENS,
  approxTokenCount,
  buildSummariserPrompt,
  summariseEarlierTurns,
  type AnchoredSummaryInput,
  type AnchoredSummaryResult,
  type ConversationTurn,
} from './anchored-summary.js';

// ── FadeMem eviction ────────────────────────────────────────────────
export {
  DEFAULT_HARD_EVICT_DAYS,
  DEFAULT_SOFT_DELETE_THRESHOLD,
  FADEMEM_DECAY_RATE,
  MS_PER_DAY,
  effectiveScore,
  hardEvictSweep,
  runEvictionSweep,
  softDeleteSweep,
} from './eviction.js';

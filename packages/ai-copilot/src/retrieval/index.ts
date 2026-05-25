/**
 * Contextual retrieval — BORJIE `ai-copilot/retrieval`.
 *
 * Five-piece RAG stack ported from LITFIN's iter-51 contextual-rag
 * package, with three deliberate improvements over the upstream:
 *
 *   1. Reciprocal Rank Fusion is the default (LITFIN used convex-only
 *      with a hardcoded alpha=0.5). RRF is robust to heterogeneous
 *      score distributions per Anthropic / Cohere benchmarks.
 *   2. The contextual chunker is brain-neutral — the LLM call is
 *      injected, so the module has no runtime dependency on any
 *      provider. Identity-fallback when none is wired.
 *   3. `cohere-rerank.ts` surfaces a `fallbackUsed` flag so
 *      observability dashboards can track when the reranker degraded
 *      to identity ordering (no key / network failure).
 *
 * Identity-fallback policy is preserved across the stack:
 *   - Contextual chunker: empty preface → embedText = chunkText.
 *   - Cohere rerank: no key / failure → original order + synthetic
 *     descending scores in [0.5, 1.0].
 *
 * Both let the pipeline ship before Anthropic / Cohere keys are
 * provisioned, with graceful degradation in observed quality only.
 *
 * @module @borjie/ai-copilot/retrieval
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  Chunk,
  ChunkSentence,
  ChunkSource,
  Citation,
  ContextualChunk,
  Embedder,
  FusionStrategy,
  HybridAlpha,
  RetrievalHit,
  RetrievalRequest,
  RetrievalResult,
} from './types.js';

// ---------------------------------------------------------------------------
// BM25 lexical retrieval
// ---------------------------------------------------------------------------

export {
  buildBM25Index,
  scoreBM25,
  searchBM25,
  tokenize,
  type BM25Document,
  type BM25Index,
  type BM25Score,
} from './bm25.js';

// ---------------------------------------------------------------------------
// Contextual chunker — Anthropic contextual retrieval pattern
// ---------------------------------------------------------------------------

export {
  contextualizeChunks,
  parseContextSummaries,
  type ContextualizeFn,
  type ContextualizeOptions,
} from './contextual-chunker.js';

// ---------------------------------------------------------------------------
// Hybrid search — vector + BM25 + RRF
// ---------------------------------------------------------------------------

export {
  hybridSearch,
  fuseRRF,
  convexFuse,
  rrfContribution,
  DEFAULT_HYBRID_ALPHA,
  RRF_K_CONSTANT,
  type HybridSearchInput,
  type VectorCandidate,
} from './hybrid-search.js';

// ---------------------------------------------------------------------------
// Cohere Rerank 3.5
// ---------------------------------------------------------------------------

export {
  rerankCandidates,
  COHERE_RERANK_MODEL_ID,
  type RerankCandidate,
  type RerankedCandidate,
  type RerankOptions,
  type RerankResult,
} from './cohere-rerank.js';

// ---------------------------------------------------------------------------
// Span-level citations
// ---------------------------------------------------------------------------

export {
  splitChunkIntoSentences,
  extractCitedSpans,
  findSpanForClaim,
  verifySpan,
} from './span-citations.js';

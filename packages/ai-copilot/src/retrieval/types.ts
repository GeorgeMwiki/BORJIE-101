/**
 * Retrieval — shared types.
 *
 * Domain primitives for the BORJIE contextual-retrieval stack. The
 * goal is one canonical `Chunk` / `Citation` / `RetrievalResult` shape
 * so contextual chunker, BM25, hybrid fusion, Cohere rerank, and
 * span-citation modules all interoperate without per-module type fans.
 *
 * Ported from LITFIN `src/core/document-intelligence/contextual-rag/`
 * (5 files, ~1260 LOC). LITFIN spread these types across `bm25-hybrid`,
 * `cohere-reranker`, `span-citations`, etc.; the BORJIE port
 * centralises them here so callers in the property-management domain
 * (lease docs, inspection reports, owner statements) work against one
 * stable interface.
 *
 * Pure types only — no I/O, no side effects, safe from any tier.
 *
 * @module @borjie/ai-copilot/retrieval/types
 */

// ---------------------------------------------------------------------------
// Chunk — the smallest indexable unit
// ---------------------------------------------------------------------------

/**
 * A single retrievable chunk. Same shape used as input to BM25 +
 * hybrid fusion + reranker + span citations.
 */
export interface Chunk {
  /** Stable id, e.g. `lease-2026-q1-c0007` or `inspection-r12-p3`. */
  readonly id: string;
  /** The literal text of the chunk. Never mutated by retrieval. */
  readonly text: string;
  /** Optional source document id — useful for grouping span hits back
   *  to a parent document in the UI. */
  readonly documentId?: string;
  /** Optional zero-based ordinal inside the parent document. */
  readonly chunkIndex?: number;
  /** Arbitrary passthrough metadata (page number, section heading,
   *  property id, tenant id). Retrieval never reads these — they ride
   *  along for the consumer. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * A chunk that has been paired with a document-level context summary
 * (Anthropic contextual retrieval pattern). `embedText` is the string
 * that should be passed to the embedder — preface + chunk when the
 * summary is non-empty, plain chunk when not.
 */
export interface ContextualChunk {
  readonly chunkIndex: number;
  readonly chunkText: string;
  /** 1-2 sentence document-level summary. Empty string when the LLM
   *  call failed or was skipped — callers must treat the empty string
   *  as a no-op preface (use chunkText alone). */
  readonly contextSummary: string;
  /** The text that should be embedded — preface concatenated with the
   *  chunk. When `contextSummary` is empty, equals `chunkText`. */
  readonly embedText: string;
}

// ---------------------------------------------------------------------------
// Retrieval request / result
// ---------------------------------------------------------------------------

/**
 * Convex-combination weight on the vector signal in hybrid fusion.
 * 1.0 = pure vector, 0.0 = pure BM25, 0.5 = equal weight (Anthropic
 * reference). Reciprocal-rank-fusion mode ignores alpha entirely.
 */
export type HybridAlpha = number;

/** Fusion strategy for hybrid retrieval. */
export type FusionStrategy = 'convex' | 'rrf';

export interface RetrievalRequest {
  /** Free-text query. */
  readonly query: string;
  /** Hard cap on the number of results returned. */
  readonly topK: number;
  /** Hybrid-fusion alpha when strategy === 'convex'. Default 0.5. */
  readonly alpha?: HybridAlpha;
  /** Default 'rrf' — Reciprocal Rank Fusion is more robust to
   *  heterogeneous score distributions per Anthropic / Cohere
   *  benchmarks. Pass 'convex' for the legacy weighted-sum behaviour. */
  readonly fusion?: FusionStrategy;
  /** Whether to call the Cohere reranker after fusion. Default true.
   *  Identity-fallbacks when `COHERE_API_KEY` is absent. */
  readonly rerank?: boolean;
  /** Minimum hybrid score floor; results below are dropped. Default 0. */
  readonly minScore?: number;
}

/** A single hit from the retrieval pipeline. */
export interface RetrievalHit {
  readonly chunk: Chunk;
  /** Final hybrid score (after fusion + optional rerank). Higher = more relevant. */
  readonly score: number;
  /** Raw vector similarity in [0, 1]. 0 when chunk had no vector match. */
  readonly vectorScore: number;
  /** Raw BM25 score (unbounded). 0 when no lexical match. */
  readonly bm25Score: number;
  /** Rerank score in [0, 1] from Cohere Rerank 3.5. When the rerank
   *  step was skipped or the identity-fallback fired, this carries the
   *  synthetic descending score so downstream consumers can keep sorting. */
  readonly rerankScore?: number;
}

export interface RetrievalResult {
  /** Hits ordered highest-first. */
  readonly hits: ReadonlyArray<RetrievalHit>;
  /** The query as run (caller-side preprocessing may have stripped it). */
  readonly normalisedQuery: string;
  /** True when the rerank fallback fired (no API key OR network
   *  failure). Useful for observability dashboards. */
  readonly rerankFallbackUsed: boolean;
}

// ---------------------------------------------------------------------------
// Citation — span-level evidence for LLM answers
// ---------------------------------------------------------------------------

/**
 * A character-offset span inside a chunk that the LLM cited. Cuts
 * citation hallucination from ~37% (whole-chunk citations) to single
 * digits per FRONT paper.
 */
export interface Citation {
  readonly chunkId: string;
  /** Inclusive start offset inside `chunk.text`. */
  readonly startOffset: number;
  /** Exclusive end offset inside `chunk.text`. */
  readonly endOffset: number;
  /** Literal substring of the chunk the citation anchors to.
   *  Equal to `chunkText.slice(startOffset, endOffset)`. */
  readonly quotedSpan: string;
  /** Jaccard overlap between the LLM context window and the chosen
   *  sentence. 1.0 = perfect match. Useful for an audit pass that
   *  blocks low-confidence citations. */
  readonly overlap: number;
}

/** A chunk with its source text — minimum shape the span citation
 *  extractor needs to resolve `[chunkId]` markers in LLM output. */
export interface ChunkSource {
  readonly id: string;
  readonly text: string;
}

/** Sentence segment with offsets that satisfy
 *  `chunk.text.slice(s.startOffset, s.endOffset) === s.text`. */
export interface ChunkSentence {
  readonly text: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

// ---------------------------------------------------------------------------
// Embedder — shared with `../memory/`
// ---------------------------------------------------------------------------

/**
 * Same shape as the `Embedder` exported from `../memory/semantic-memory`.
 * Re-declared here so callers can use the retrieval pipeline without
 * pulling in the whole memory module surface area — both refer to the
 * SAME logical interface.
 */
export type Embedder = (text: string) => Promise<readonly number[]>;

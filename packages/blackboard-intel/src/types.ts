/**
 * `@borjie/blackboard-intel` — public type surface.
 *
 * Wave BLACKBOARD-INTEL. Wires the blackboard into the self-improving
 * loop and adds hybrid (FTS + dense + RRF) search across blackboard
 * history.
 *
 * No I/O, no global state — only immutable shapes. The package never
 * imports `@borjie/blackboard-sota` (BLACKBOARD-CORE sibling wave) or
 * `@borjie/intel-self-improve` directly — both are depended on via
 * structural ports so we keep the build order free.
 *
 * Spec: Docs/DESIGN/BLACKBOARD_INTEL_SOTA_2026.md.
 *
 * @module @borjie/blackboard-intel/types
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/**
 * The three KS (knowledge source) kinds we recognise for blackboard
 * posts. Mirrors the BLACKBOARD-CORE wave's post taxonomy. Every
 * post is attributed to one of these three.
 */
export const BLACKBOARD_CAPABILITY_KINDS = [
  'junior',
  'connector',
  'tool',
] as const;
export type BlackboardCapabilityKind =
  (typeof BLACKBOARD_CAPABILITY_KINDS)[number];

/**
 * The three quality axes we measure per post. Each emits a
 * PostQualityScore row when computed.
 */
export const QUALITY_AXES = [
  'groundedness',
  'calibration',
  'utility',
] as const;
export type QualityAxis = (typeof QUALITY_AXES)[number];

// ---------------------------------------------------------------------------
// Structural ports for sibling waves (BLACKBOARD-CORE, intel-self-improve)
// ---------------------------------------------------------------------------

/**
 * Minimal structural shape we need from BLACKBOARD-CORE's
 * `blackboard_posts_v2` reader. Implementations either back this with
 * the concrete `@borjie/blackboard-sota` package (production) or with
 * the in-memory adapter shipped here (tests).
 */
export interface BlackboardPostRef {
  readonly id: string;
  readonly tenantId: string;
  readonly content: string;
  readonly authorKind: BlackboardCapabilityKind;
  /** Citation IDs referenced by this post (e.g. memory-cell IDs). */
  readonly citations: ReadonlyArray<string>;
  /** ISO-8601 timestamp the post was created at. */
  readonly postedAt: string;
  /** Optional parent thread (root post in a thread of follow-ups). */
  readonly parentThreadId: string | null;
  /** Soft hedge markers detected at write time. */
  readonly hedgeMarkers: ReadonlyArray<string>;
  /** Optional pre-computed embedding (1536-d). */
  readonly contentEmbedding: ReadonlyArray<number> | null;
}

export interface BlackboardCorePort {
  /** Fetch a single post; null if not found OR if tenantId mismatches. */
  readonly readPost: (
    tenantId: string,
    postId: string,
  ) => Promise<BlackboardPostRef | null>;
  /** List all posts that cross-reference the given post (later in time). */
  readonly listCrossRefsTo: (
    tenantId: string,
    postId: string,
  ) => Promise<ReadonlyArray<BlackboardPostRef>>;
  /** List all posts in the thread containing the given post, ordered. */
  readonly listThread: (
    tenantId: string,
    threadId: string,
  ) => Promise<ReadonlyArray<BlackboardPostRef>>;
  /**
   * Resolve which of the given citation IDs are still reachable
   * (i.e. point to live rows in cognitive memory / cross-references).
   * The set of resolvable IDs is returned; non-resolvable ones are
   * silently filtered. Order is not guaranteed.
   */
  readonly resolveCitations: (
    tenantId: string,
    citationIds: ReadonlyArray<string>,
  ) => Promise<ReadonlyArray<string>>;
}

/**
 * Structural shape for a measurement-wrapper. Mirrors the API
 * surface of `@borjie/intel-self-improve#wrapAsMeasured` without
 * importing the concrete package. The blackboard-intel package uses
 * this to wrap each KS-invocation so it is observed and audited.
 */
export interface MeasurementWrapperPort {
  readonly wrap: <TInput, TOutput>(
    capabilityName: string,
    capabilityKind: BlackboardCapabilityKind,
    fn: (input: TInput) => Promise<TOutput>,
  ) => (input: TInput) => Promise<TOutput>;
}

// ---------------------------------------------------------------------------
// Capability registration port (structural — capability-catalogue compatible)
// ---------------------------------------------------------------------------

/**
 * Author-side input for a capability row. Matches the shape of
 * `@borjie/capability-catalogue`'s `CapabilityAuthorInput` so a
 * concrete registry can be plugged in without adapters.
 */
export interface BlackboardCapabilityAuthor {
  readonly tenantId: string;
  readonly name: string;
  readonly version: string;
  readonly kind: 'atomic' | 'meta' | 'tenant';
  readonly owner: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly contract: {
    readonly costClass: 'free' | 'tier_1' | 'tier_2' | 'tier_3';
    readonly latencyBudgetMs: number;
  };
  readonly provenanceClass: 'seed' | 'spawned' | 'tenant_authored';
}

export interface CapabilityRegistryPort {
  /**
   * Register a capability in the catalogue. Returns the capability ID.
   * Implementations are expected to be idempotent on (tenantId, name,
   * version): a duplicate register call returns the existing ID.
   */
  readonly register: (
    author: BlackboardCapabilityAuthor,
  ) => Promise<string>;
  /** Look up a capability by its tenant-scoped name + version. */
  readonly lookup: (
    tenantId: string,
    name: string,
    version: string,
  ) => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Quality scoring — rows persisted to blackboard_post_quality_scores
// ---------------------------------------------------------------------------

/**
 * One row in `blackboard_post_quality_scores`. Score is in [0, 1].
 * Three rows are emitted per post — one per axis.
 */
export interface PostQualityScore {
  readonly id: string;
  readonly tenantId: string;
  readonly postId: string;
  readonly axis: QualityAxis;
  readonly score: number;
  readonly scoredAt: string;
  readonly prevHash: string;
  readonly auditHash: string;
}

// ---------------------------------------------------------------------------
// Search — query and result shapes
// ---------------------------------------------------------------------------

/**
 * Filters that scope a search. Always combined with the implicit
 * tenant scope.
 */
export interface SearchFilters {
  readonly region?: string;
  readonly capabilityKind?: BlackboardCapabilityKind;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly parentThreadId?: string;
  /** When true, restricts to posts that have at least one cross-ref. */
  readonly hasCrossRef?: boolean;
}

export interface SearchQuery {
  readonly tenantId: string;
  readonly text: string;
  readonly k?: number;
  readonly filters?: SearchFilters;
}

export interface SearchResult {
  readonly postId: string;
  readonly tenantId: string;
  readonly score: number;
  /** Snippet of the post content, truncated to ~300 chars. */
  readonly snippet: string;
  /** Optional metadata — author, posted_at, citations resolved. */
  readonly meta: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Hybrid retrieval configuration — RRF tuning
// ---------------------------------------------------------------------------

/**
 * Knobs for the hybrid retriever. The defaults are the Cormack 2009
 * recommendation (`k = 60`) with equal weight on both rank streams.
 */
export interface HybridRetrievalConfig {
  /** RRF constant `k` — Cormack 2009 §3 recommends 60. */
  readonly k: number;
  /** Multiplicative weight on the FTS rank contribution. */
  readonly k1: number;
  /** Multiplicative weight on the dense rank contribution. */
  readonly k2: number;
  /** How many results to ask each underlying retriever for. */
  readonly perRetrieverK: number;
  /** How many fused results to return. */
  readonly fusedK: number;
}

export const DEFAULT_HYBRID_CONFIG: HybridRetrievalConfig = Object.freeze({
  k: 60,
  k1: 1.0,
  k2: 1.0,
  perRetrieverK: 50,
  fusedK: 10,
});

// ---------------------------------------------------------------------------
// Repositories — typed ports for the two new tables
// ---------------------------------------------------------------------------

/**
 * Repository for `blackboard_post_quality_scores`. Both the in-memory
 * and SQL adapters implement this contract.
 */
export interface PostQualityScoresRepository {
  /** Insert a score row. Throws if id is already present. */
  readonly insert: (row: PostQualityScore) => Promise<void>;
  /** Read every score for a single post, all axes, newest first. */
  readonly listForPost: (
    tenantId: string,
    postId: string,
  ) => Promise<ReadonlyArray<PostQualityScore>>;
  /** Tip score per axis for a post (used by the meta-curator). */
  readonly tipPerAxis: (
    tenantId: string,
    postId: string,
  ) => Promise<Readonly<Partial<Record<QualityAxis, PostQualityScore>>>>;
}

/**
 * Repository for `blackboard_search_index`. Both adapters implement
 * the same contract. The SQL adapter delegates the tsvector query
 * back to Postgres; the in-memory adapter materialises a simple
 * inverted-index analogue.
 */
export interface SearchIndexRepository {
  /** Upsert (post_id, tenant_id, content, audit_hash). */
  readonly upsert: (
    row: Readonly<{
      postId: string;
      tenantId: string;
      content: string;
      auditHash: string;
    }>,
  ) => Promise<void>;
  /**
   * Plain-text search returning post IDs ordered by FTS rank, scoped
   * to the calling tenant. The `tsquery` translation lives in the SQL
   * adapter; the in-memory adapter uses lowercase substring matches.
   */
  readonly ftsSearch: (
    tenantId: string,
    text: string,
    k: number,
  ) => Promise<ReadonlyArray<Readonly<{ postId: string; rank: number }>>>;
  /** Get the indexed content for a post (used to build snippets). */
  readonly getContent: (
    tenantId: string,
    postId: string,
  ) => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Embedding port — minimal subset we need from cognitive-memory
// ---------------------------------------------------------------------------

export interface EmbeddingPort {
  /**
   * Returns a 1536-dim vector for the given text. Implementations must
   * be deterministic for tests — production wires the OpenAI
   * embedding API behind a budget gate.
   */
  readonly embed: (text: string) => Promise<ReadonlyArray<number>>;
}

// ---------------------------------------------------------------------------
// Dense-search port — wraps pgvector HNSW or in-memory cosine
// ---------------------------------------------------------------------------

export interface DenseSearchIndexPort {
  /** Upsert a vector for (postId, tenantId). */
  readonly upsert: (
    row: Readonly<{
      postId: string;
      tenantId: string;
      embedding: ReadonlyArray<number>;
    }>,
  ) => Promise<void>;
  /**
   * Cosine-similarity search returning post IDs ranked best-first.
   * Implementations must filter by tenantId BEFORE scoring.
   */
  readonly search: (
    tenantId: string,
    queryEmbedding: ReadonlyArray<number>,
    k: number,
  ) => Promise<ReadonlyArray<Readonly<{ postId: string; similarity: number }>>>;
}

// ---------------------------------------------------------------------------
// Audit chain port — same shape as @borjie/intel-self-improve
// ---------------------------------------------------------------------------

export interface AuditChainPort {
  readonly hash: (
    prevHash: string | null,
    payload: Readonly<Record<string, unknown>>,
  ) => string;
}

// ---------------------------------------------------------------------------
// Clock + UUID + Logger ports
// ---------------------------------------------------------------------------

export interface ClockPort {
  readonly nowIso: () => string;
  readonly nowMs: () => number;
}

export interface UuidPort {
  readonly next: () => string;
}

export interface Logger {
  readonly debug: (message: string, meta?: Record<string, unknown>) => void;
  readonly info: (message: string, meta?: Record<string, unknown>) => void;
  readonly warn: (message: string, meta?: Record<string, unknown>) => void;
  readonly error: (message: string, meta?: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Meta-learning conductor curator port — RawTrace-compatible adapter
// ---------------------------------------------------------------------------

/**
 * Trace shape we hand off to the meta-learning conductor's curator.
 * Mirrors the `RawTrace` interface from
 * `@borjie/meta-learning-conductor` without importing the package.
 */
export interface BlackboardRawTrace {
  readonly id: string;
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly prompt: Readonly<Record<string, unknown>>;
  readonly completion: Readonly<Record<string, unknown>>;
  readonly baseReward: number;
  readonly coverageScore: number;
  readonly confidenceScore: number;
  readonly redactionPenalty: number;
  readonly occurredAt: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type BlackboardIntelErrorCode =
  | 'POST_NOT_FOUND'
  | 'CROSS_TENANT_REJECTED'
  | 'INVALID_AXIS'
  | 'INVALID_SCORE_RANGE'
  | 'DUPLICATE_SCORE_ID'
  | 'EMPTY_QUERY'
  | 'EMBEDDING_DIM_MISMATCH';

export class BlackboardIntelError extends Error {
  public readonly code: BlackboardIntelErrorCode;

  constructor(message: string, code: BlackboardIntelErrorCode) {
    super(message);
    this.name = 'BlackboardIntelError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Embedding constants
// ---------------------------------------------------------------------------

/** Embedding dimension — matches the Wave 18AA convention. */
export const EMBEDDING_DIM = 1536 as const;

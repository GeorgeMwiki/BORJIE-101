/**
 * A-Mem / persistent memory layer — port-side types.
 *
 * Mirrors migration 0181's three tables (memory_blocks, episodic_notes,
 * anchor_summaries) as duck-typed structural interfaces the kernel
 * consumes. The Drizzle-backed implementations live in
 * `@borjie/database`; this file keeps the kernel free of an
 * inter-package compile-time dependency.
 */

// ─────────────────────────────────────────────────────────────────────
// Memory blocks (Letta-style)
// ─────────────────────────────────────────────────────────────────────

export interface MemoryBlock {
  readonly id: string;
  readonly tenantId: string | null;
  readonly sessionId: string;
  /** 'persona' | 'human' | 'preferences' | 'project' | … */
  readonly kind: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MemoryBlockUpsert {
  readonly id?: string;
  readonly tenantId: string | null;
  readonly sessionId: string;
  readonly kind: string;
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
}

export interface MemoryBlockStore {
  /** Return all blocks for the (tenant, session) — ordered by `updatedAt` desc. */
  list(args: {
    readonly tenantId: string | null;
    readonly sessionId: string;
  }): Promise<ReadonlyArray<MemoryBlock>>;
  /** Insert-or-update by (tenantId, sessionId, kind). */
  upsert(block: MemoryBlockUpsert): Promise<MemoryBlock>;
  /** Delete a single block by id. */
  remove(args: {
    readonly tenantId: string | null;
    readonly id: string;
  }): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// Episodic notes (A-Mem)
// ─────────────────────────────────────────────────────────────────────

export interface EpisodicEvent {
  readonly kind?: string;
  readonly [k: string]: unknown;
}

export interface EpisodicNote {
  readonly id: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly turnIdx: number;
  readonly event: Record<string, unknown>;
  readonly facts: ReadonlyArray<string>;
  /** Embedding of `facts.join(' ')`. Empty array when there were no facts. */
  readonly embedding: ReadonlyArray<number>;
  readonly importanceScore: number;
  readonly parents: ReadonlyArray<string>;
  readonly accessCount: number;
  readonly createdAt: Date;
  readonly lastAccessedAt: Date;
  readonly softDeletedAt: Date | null;
}

export interface EpisodicCandidateQuery {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly limit: number;
}

export interface EpisodicEmbeddingQuery {
  readonly tenantId: string;
  readonly embedding: ReadonlyArray<number>;
  readonly limit: number;
}

export interface EpisodicBumpArgs {
  readonly tenantId: string;
  readonly ids: ReadonlyArray<string>;
}

export interface EpisodicSweepResult {
  readonly softDeleted: number;
  readonly hardDeleted: number;
}

export interface EpisodicRepo {
  /** Identifier minter — adapters may provide a deterministic one for tests. */
  generateId?(): string;
  /** Clock — adapters may override to inject a fixed `Date` for tests. */
  now?(): Date;
  insert(note: EpisodicNote): Promise<void>;
  findCandidates(args: EpisodicCandidateQuery): Promise<ReadonlyArray<EpisodicNote>>;
  searchByEmbedding(args: EpisodicEmbeddingQuery): Promise<ReadonlyArray<EpisodicNote>>;
  bumpAccess?(args: EpisodicBumpArgs): Promise<void>;
  /** Soft-delete every note whose effective score < `threshold`. */
  softDeleteBelow?(args: {
    readonly tenantId?: string;
    readonly threshold: number;
    readonly now: Date;
  }): Promise<number>;
  /** Hard-delete every note soft-deleted ≥ `olderThanDays` ago. */
  hardDeleteOlderThan?(args: {
    readonly tenantId?: string;
    readonly olderThanDays: number;
    readonly now: Date;
  }): Promise<number>;
  /** Stream all live (non-soft-deleted) notes for the eviction sweep. */
  streamAll?(args: {
    readonly tenantId?: string;
  }): Promise<ReadonlyArray<EpisodicNote>>;
}

// ─────────────────────────────────────────────────────────────────────
// Anchor summaries
// ─────────────────────────────────────────────────────────────────────

export interface AnchorSummary {
  readonly id: string;
  readonly tenantId: string | null;
  readonly sessionId: string;
  readonly startTurnIdx: number;
  readonly endTurnIdx: number;
  readonly summary: string;
  readonly originalTokens: number;
  readonly summaryTokens: number;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: Date;
}

export interface AnchorSummaryInsert {
  readonly id?: string;
  readonly tenantId: string | null;
  readonly sessionId: string;
  readonly startTurnIdx: number;
  readonly endTurnIdx: number;
  readonly summary: string;
  readonly originalTokens: number;
  readonly summaryTokens: number;
  readonly metadata?: Record<string, unknown>;
}

export interface AnchorSummaryRepo {
  list(args: {
    readonly tenantId: string | null;
    readonly sessionId: string;
  }): Promise<ReadonlyArray<AnchorSummary>>;
  insert(summary: AnchorSummaryInsert): Promise<AnchorSummary>;
}

// ─────────────────────────────────────────────────────────────────────
// Hybrid retrieval — BM25 + vector union with Reciprocal Rank Fusion.
// ─────────────────────────────────────────────────────────────────────

export interface RetrievalCandidate {
  readonly id: string;
  readonly text: string;
  /** Optional embedding — required only for the vector-rank branch. */
  readonly embedding?: ReadonlyArray<number>;
  /** Optional metadata for traceability. */
  readonly metadata?: Record<string, unknown>;
}

export interface HybridRetrievalRepo {
  /** BM25-ranked candidates for `query`; adapters may use Postgres FTS. */
  searchBm25(args: {
    readonly tenantId: string;
    readonly sessionId: string;
    readonly query: string;
    readonly limit: number;
  }): Promise<ReadonlyArray<RetrievalCandidate>>;
  /** Vector-ranked candidates for `embedding`. */
  searchVector(args: {
    readonly tenantId: string;
    readonly sessionId: string;
    readonly embedding: ReadonlyArray<number>;
    readonly limit: number;
  }): Promise<ReadonlyArray<RetrievalCandidate>>;
}

// ─────────────────────────────────────────────────────────────────────
// LLM port for anchored summarisation.
// ─────────────────────────────────────────────────────────────────────

export interface LLMPort {
  /**
   * Single-shot completion — returns plain text. The summariser invokes
   * this with a fully-composed prompt; no streaming, no tool calls.
   */
  complete(args: {
    readonly prompt: string;
    readonly maxTokens?: number;
    readonly temperature?: number;
  }): Promise<string>;
}

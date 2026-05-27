/**
 * Public type surface for @borjie/recommendations.
 *
 * Persona: Mr. Mwikila — Borjie's autonomous Managing Director for
 * Tanzanian mining operators. Every request crossing this package
 * carries a `tenantId` and is isolated by it at every layer.
 *
 * No runtime symbols in this file — these are the **only** shapes
 * the rest of the platform should depend on, and the LLM-reranker,
 * two-tower retriever, and explanation generator are all ports
 * declared in their own files so production wires LLM brains via
 * `RecommendationPort`, `LLMRerankerPort`, `TwoTowerPort`, and
 * `ExplanationPort`.
 */

// ───────────────────────────────────────────────────────────────────
// Match targets and algorithm tags.
// ───────────────────────────────────────────────────────────────────

/** Mining-domain match target. */
export type MatchTarget =
  | 'buyer_mine'
  | 'worker_site'
  | 'regulator_filing'
  | 'supplier_mine'
  | 'course_worker';

/** Algorithm tag. Singletons + 'ensemble:<spec>' for composites. */
export type AlgorithmTag =
  | 'popularity'
  | 'content_based'
  | 'user_user_cf'
  | 'item_item_cf'
  | 'matrix_factorization'
  | 'llm_rerank'
  | 'two_tower'
  | 'thompson_sampling'
  | 'linucb'
  | 'coldstart_router'
  | `ensemble:${string}`;

/** Feedback signal — matches `recommendation_feedback_signal_chk`. */
export type FeedbackSignal = 'click' | 'dismiss' | 'convert' | 'rate';

// ───────────────────────────────────────────────────────────────────
// Core data shapes.
// ───────────────────────────────────────────────────────────────────

/**
 * A dense embedding vector. The producer is tenant-scoped — vectors
 * from different tenants are never compared. The tenant boundary is
 * enforced by every algorithm in this package: a candidate whose
 * `tenantId` differs from the request's throws synchronously.
 */
export interface EmbeddingVector {
  readonly tenantId: string;
  readonly id: string;
  readonly values: ReadonlyArray<number>;
}

/** A user / actor — a buyer, worker, regulator, supplier, or course-seeker. */
export interface User {
  readonly tenantId: string;
  readonly id: string;
  readonly features?: Readonly<Record<string, number | string>>;
  readonly embedding?: EmbeddingVector;
}

/**
 * An item — a candidate to recommend (mine, site, filing, supplier,
 * course; or a buyer when the target is reversed).
 */
export interface Item {
  readonly tenantId: string;
  readonly id: string;
  readonly features?: Readonly<Record<string, number | string>>;
  readonly embedding?: EmbeddingVector;
}

/** A single observed interaction between a user and an item. */
export interface Interaction {
  readonly tenantId: string;
  readonly userId: string;
  readonly itemId: string;
  readonly rating: number;
  readonly timestamp: number;
}

/** One scored item in a ranking. */
export interface ScoredItem {
  readonly itemId: string;
  readonly score: number;
  readonly reason?: string;
}

// ───────────────────────────────────────────────────────────────────
// Request / response envelopes.
// ───────────────────────────────────────────────────────────────────

/** The envelope every algorithm returns. */
export interface RecommendationResult {
  readonly tenantId: string;
  readonly target: MatchTarget;
  readonly algorithm: AlgorithmTag;
  readonly userId: string;
  readonly topK: ReadonlyArray<ScoredItem>;
  readonly candidates: ReadonlyArray<string>;
  readonly servedAt: number;
  readonly auditHash: string;
  readonly prevHash: string;
}

/**
 * Request envelope. The algorithm receives ONLY this — no global
 * store, no cross-tenant leak. The caller is responsible for
 * supplying the tenant's interaction set; the package never reads
 * from a global table.
 */
export interface RecommendationRequest {
  readonly tenantId: string;
  readonly target: MatchTarget;
  readonly userId: string;
  readonly user?: User;
  readonly candidates: ReadonlyArray<Item>;
  readonly interactions: ReadonlyArray<Interaction>;
  readonly topK: number;
  /** Optional seed for deterministic algorithms (matrix factorization,
   *  Thompson Sampling). */
  readonly seed?: number;
}

// ───────────────────────────────────────────────────────────────────
// Persisted-row shapes (mirror migration 0071).
// ───────────────────────────────────────────────────────────────────

/** A recorded feedback row. */
export interface RecommendationFeedback {
  readonly id: string;
  readonly runId: string;
  readonly userId: string;
  readonly itemId: string;
  readonly signal: FeedbackSignal;
  readonly value: number;
  readonly recordedAt: number;
  readonly auditHash: string;
}

/** A persisted run row. */
export interface RecommendationRun {
  readonly id: string;
  readonly tenantId: string;
  readonly target: MatchTarget;
  readonly algorithm: AlgorithmTag;
  readonly candidates: ReadonlyArray<string>;
  readonly topKItems: ReadonlyArray<string>;
  readonly scores: ReadonlyArray<ScoredItem>;
  readonly servedAt: number;
  readonly prevHash: string;
  readonly auditHash: string;
}

// ───────────────────────────────────────────────────────────────────
// Port the rest of the package implements.
// ───────────────────────────────────────────────────────────────────

/**
 * The interface every algorithm in this package implements. The
 * implementation accepts ONLY the request — no implicit global
 * state, no cross-tenant fan-out.
 */
export interface RecommendationPort {
  readonly algorithm: AlgorithmTag;
  recommend(request: RecommendationRequest): RecommendationResult;
}

/**
 * Kernel memory ports — duck-typed structural interfaces the kernel
 * reads from / writes to without compile-time depending on
 * `@borjie/database`. The api-gateway composition root binds these
 * to Drizzle-backed services in `packages/database`. Test rigs bind
 * them to in-memory fakes.
 *
 * Four memory kinds, mirroring LITFIN's `episodic-store` /
 * `semantic-store` / `procedural-store` / `reflective-store`:
 *
 *   - Episodic   : concrete past events. Tied to (threadId, turnId).
 *                  TTL-able. Per-(tenant, user).
 *   - Semantic   : extracted facts with confidence + evidence_count.
 *                  Per-tenant + per-(tenant, user) variants share
 *                  the same store; tenant-scope facts have a null
 *                  user id.
 *   - Procedural : recurring tool-sequence patterns ranked by
 *                  historical success rate.
 *   - Reflective : periodic summaries written by the consolidation
 *                  cycle agent (separate composition root). The
 *                  kernel only READS these.
 *
 * Every method returns a Promise so adapters are free to be async at
 * any layer; in-memory fakes can simply `Promise.resolve(...)`.
 */

// ─────────────────────────────────────────────────────────────────────
// Episodic
// ─────────────────────────────────────────────────────────────────────

export type EpisodicKind = 'user-message' | 'agent-action' | 'tool-result';

export interface EpisodicEntry {
  readonly id: string;
  readonly tenantId: string | null;
  readonly userId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly kind: EpisodicKind;
  readonly summary: string;
  readonly payload: Record<string, unknown>;
  readonly capturedAt: string;
  readonly expiresAt: string | null;
}

export interface EpisodicRecordArgs {
  readonly tenantId: string | null;
  readonly userId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly kind: EpisodicKind;
  readonly summary: string;
  readonly payload?: Record<string, unknown>;
  readonly ttlDays?: number | null;
}

export interface EpisodicRecallArgs {
  readonly tenantId: string | null;
  readonly userId: string;
  readonly since?: string;
  readonly limit?: number;
}

export interface EpisodicMemoryPort {
  record(args: EpisodicRecordArgs): Promise<void>;
  recall(args: EpisodicRecallArgs): Promise<ReadonlyArray<EpisodicEntry>>;
  purgeExpired(): Promise<number>;
}

// ─────────────────────────────────────────────────────────────────────
// Semantic
// ─────────────────────────────────────────────────────────────────────

export type SemanticSource = 'extracted' | 'declared' | 'consolidated';

export interface SemanticFact {
  readonly id: string;
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly key: string;
  readonly value: unknown;
  readonly confidence: number;
  readonly sourceTurnId: string | null;
  readonly evidenceCount: number;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string | null;
  readonly source: SemanticSource;
}

export interface SemanticUpsertArgs {
  readonly tenantId: string | null;
  readonly userId?: string | null;
  readonly key: string;
  readonly value: unknown;
  readonly confidence: number;
  readonly sourceTurnId?: string | null;
  readonly source?: SemanticSource;
}

export interface SemanticLookupArgs {
  readonly tenantId: string | null;
  readonly userId?: string | null;
  readonly key: string;
}

export interface SemanticSearchArgs {
  readonly tenantId: string | null;
  readonly userId?: string | null;
  readonly prefix?: string;
  readonly limit?: number;
}

export interface SemanticSearchByEmbeddingArgs {
  readonly tenantId: string | null;
  readonly userId?: string | null;
  /**
   * Caller-produced query embedding. Producer-side dimensionality
   * (OpenAI text-embedding-3-small = 1536). Adapters validate.
   */
  readonly embedding: ReadonlyArray<number>;
  /** Maximum number of facts to return. Default 8. */
  readonly limit?: number;
  /**
   * Maximum cosine distance (0 = identical, 2 = opposite). Facts
   * with `<=> embedding > maxDistance` are filtered out. Default 1.0
   * for parity with the database service.
   */
  readonly maxDistance?: number;
}

export interface SemanticFactWithSimilarity extends SemanticFact {
  /** Cosine distance (0 = identical). Lower is better. */
  readonly distance: number;
}

export interface SemanticDecayArgs {
  readonly tenantId: string | null;
  readonly decayPerDay: number;
}

export interface SemanticMemoryPort {
  upsertFact(args: SemanticUpsertArgs): Promise<void>;
  lookup(args: SemanticLookupArgs): Promise<SemanticFact | null>;
  search(args: SemanticSearchArgs): Promise<ReadonlyArray<SemanticFact>>;
  /**
   * Optional embedding-based retrieval. Adapters that have a
   * pgvector / FAISS / Pinecone backend implement this; in-memory
   * fakes may omit it. Callers must guard with `typeof port.searchByEmbedding === 'function'`
   * before invoking.
   */
  searchByEmbedding?(
    args: SemanticSearchByEmbeddingArgs,
  ): Promise<ReadonlyArray<SemanticFactWithSimilarity>>;
  decay(args: SemanticDecayArgs): Promise<number>;
}

// ─────────────────────────────────────────────────────────────────────
// Procedural
// ─────────────────────────────────────────────────────────────────────

export interface ProceduralPattern {
  readonly id: string;
  readonly tenantId: string | null;
  readonly userId: string;
  readonly patternName: string;
  readonly toolSequence: ReadonlyArray<string>;
  readonly triggerKeywords: ReadonlyArray<string>;
  readonly invocations: number;
  readonly successes: number;
  readonly successRate: number;
  readonly lastInvokedAt: string | null;
  readonly createdAt: string;
  readonly matchScore?: number;
}

export interface ProceduralRecordArgs {
  readonly tenantId: string | null;
  readonly userId: string;
  readonly patternName: string;
  readonly toolSequence: ReadonlyArray<string>;
  readonly triggerKeywords: ReadonlyArray<string>;
  readonly success: boolean;
}

export interface ProceduralMatchArgs {
  readonly tenantId: string | null;
  readonly userId: string;
  readonly userMessage: string;
  readonly limit?: number;
}

export interface ProceduralMemoryPort {
  record(args: ProceduralRecordArgs): Promise<void>;
  match(args: ProceduralMatchArgs): Promise<ReadonlyArray<ProceduralPattern>>;
}

// ─────────────────────────────────────────────────────────────────────
// Reflective
// ─────────────────────────────────────────────────────────────────────

export type ReflectivePeriodKind = 'daily' | 'weekly' | 'monthly';

export interface ReflectiveTopicCount {
  readonly topic: string;
  readonly count: number;
}

export interface ReflectiveDigest {
  readonly id: string;
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly periodKind: ReflectivePeriodKind;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly summary: string;
  readonly topTopics: ReadonlyArray<ReflectiveTopicCount>;
  readonly sentimentAvg: number | null;
  readonly actionItems: ReadonlyArray<string>;
  readonly generatedAt: string;
}

export interface ReflectiveDigestInput {
  readonly tenantId: string | null;
  readonly userId?: string | null;
  readonly periodKind: ReflectivePeriodKind;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly summary: string;
  readonly topTopics?: ReadonlyArray<ReflectiveTopicCount>;
  readonly sentimentAvg?: number | null;
  readonly actionItems?: ReadonlyArray<string>;
}

export interface ReflectiveLatestArgs {
  readonly tenantId: string | null;
  readonly userId?: string | null;
  readonly periodKind: ReflectivePeriodKind;
  readonly n?: number;
}

export interface ReflectiveMemoryPort {
  latest(args: ReflectiveLatestArgs): Promise<ReadonlyArray<ReflectiveDigest>>;
  record(digest: ReflectiveDigestInput): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// Aggregate hierarchy — every store is optional. Composition roots
// pass exactly the ports they have wired; the kernel is graceful when
// any subset is missing.
// ─────────────────────────────────────────────────────────────────────

export interface MemoryHierarchy {
  readonly episodic?: EpisodicMemoryPort;
  readonly semantic?: SemanticMemoryPort;
  readonly procedural?: ProceduralMemoryPort;
  readonly reflective?: ReflectiveMemoryPort;
}

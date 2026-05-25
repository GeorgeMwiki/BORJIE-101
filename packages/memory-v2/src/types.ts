/**
 * `@borjie/memory-v2` — Public types.
 *
 * Six-layer cognitive memory inspired by LITFIN PROJECT/src/core/memory:
 *   1. Episodic   — what happened (turns / events) with bi-temporal facts
 *   2. Narrative  — multi-episode arcs that connect related events
 *   3. Procedural — recurring skills (Voyager-style promotion)
 *   4. Reflective — periodic reflective notes (Reflexion-style)
 *   5. Topic      — topic-scoped memory shards
 *   6. Cohort     — per-tenant + per-jurisdiction cache layer
 *
 * Bi-temporal model: every fact has `validFrom`/`validTo` (real-world
 * validity) AND `recordedAt` (when we wrote it). Lets you replay
 * "what did the system know about borrower X on date Y".
 *
 * All types are `readonly` end-to-end so consumers cannot mutate
 * persisted shapes after retrieval.
 */

// ─────────────────────────────────────────────────────────────────────
// Common shapes
// ─────────────────────────────────────────────────────────────────────

/** A canonical UUID-ish identifier. */
export type Id = string;

/** ISO-8601 timestamp string. */
export type IsoTimestamp = string;

/** Tenant identifier (NEVER null on tenant-scoped tables). */
export type TenantId = string;

/** Optional jurisdiction (ISO-3166-1 alpha-2 or null for global). */
export type Jurisdiction = string | null;

/**
 * Memory surface — coarse-grained "which agent / app slot".
 * Property-management aligned (replaces LITFIN credit surfaces).
 */
export type MemorySurface =
  | 'owner_portal'
  | 'estate_manager'
  | 'tenant_chat'
  | 'maintenance_agent'
  | 'leasing_agent'
  | 'finance_copilot'
  | 'compliance_copilot'
  | 'analytics_copilot'
  | 'general';

// ─────────────────────────────────────────────────────────────────────
// 1. Episodic — events with bi-temporal facts
// ─────────────────────────────────────────────────────────────────────

export interface Episode {
  readonly id: Id;
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly surface: MemorySurface;
  readonly subject: string | null;
  readonly title: string | null;
  readonly summary: string | null;
  /** Real-world start of the event. */
  readonly validFrom: IsoTimestamp;
  /** Real-world end of the event (null = ongoing). */
  readonly validTo: IsoTimestamp | null;
  /** When the system recorded the episode. */
  readonly recordedAt: IsoTimestamp;
  /** Embedding for vector recall. Empty array if not embedded yet. */
  readonly embedding: ReadonlyArray<number>;
  /** Free-form tags. */
  readonly tags: ReadonlyArray<string>;
}

export interface EpisodeFact {
  readonly id: Id;
  readonly episodeId: Id;
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly confidence: number;
  readonly validFrom: IsoTimestamp;
  readonly validTo: IsoTimestamp | null;
  readonly recordedAt: IsoTimestamp;
}

export interface EpisodeRetrievalQuery {
  readonly tenantId: TenantId;
  readonly userId?: string;
  readonly surface?: MemorySurface;
  readonly subject?: string;
  readonly queryText?: string;
  readonly queryEmbedding?: ReadonlyArray<number>;
  /** Filter by validity window (inclusive). */
  readonly validAt?: IsoTimestamp;
  readonly limit?: number;
}

export interface EpisodeWithScore {
  readonly episode: Episode;
  /** [0, 1] relevance score combining recency + embedding sim. */
  readonly score: number;
}

// ─────────────────────────────────────────────────────────────────────
// 2. Narrative arcs
// ─────────────────────────────────────────────────────────────────────

export interface NarrativeArc {
  readonly id: Id;
  readonly tenantId: TenantId;
  readonly title: string;
  readonly summary: string;
  /** Ordered list of episode ids that compose the arc. */
  readonly episodeIds: ReadonlyArray<Id>;
  readonly startedAt: IsoTimestamp;
  readonly endedAt: IsoTimestamp | null;
  readonly tags: ReadonlyArray<string>;
  readonly recordedAt: IsoTimestamp;
}

// ─────────────────────────────────────────────────────────────────────
// 3. Procedural skills (Voyager-style)
// ─────────────────────────────────────────────────────────────────────

export interface ProceduralSkill {
  readonly id: Id;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly description: string;
  readonly triggerPattern: string;
  readonly actionSequence: ReadonlyArray<Record<string, unknown>>;
  readonly observedCount: number;
  readonly successRate: number;
  /** Has the skill graduated from "observed" → "promoted/offered"? */
  readonly promoted: boolean;
  readonly lastSeenAt: IsoTimestamp;
  readonly createdAt: IsoTimestamp;
}

// ─────────────────────────────────────────────────────────────────────
// 4. Reflective notes (Reflexion-style)
// ─────────────────────────────────────────────────────────────────────

export interface ReflectiveNote {
  readonly id: Id;
  readonly tenantId: TenantId;
  readonly userId: string | null;
  /** What the agent learned from the period. */
  readonly insight: string;
  /** Concrete behavior adjustments derived from the insight. */
  readonly adjustments: ReadonlyArray<string>;
  readonly periodStart: IsoTimestamp;
  readonly periodEnd: IsoTimestamp;
  /** Score the agent assigned its own performance over the period. */
  readonly selfScore: number;
  readonly createdAt: IsoTimestamp;
}

// ─────────────────────────────────────────────────────────────────────
// 5. Topic files
// ─────────────────────────────────────────────────────────────────────

export interface TopicFile {
  readonly id: Id;
  readonly tenantId: TenantId;
  readonly topic: string;
  readonly summary: string;
  readonly facts: ReadonlyArray<EpisodeFact>;
  readonly episodeIds: ReadonlyArray<Id>;
  readonly updatedAt: IsoTimestamp;
  readonly createdAt: IsoTimestamp;
}

// ─────────────────────────────────────────────────────────────────────
// 6. Cohort cache
// ─────────────────────────────────────────────────────────────────────

export interface CohortCacheEntry<TValue = unknown> {
  readonly tenantId: TenantId;
  readonly jurisdiction: Jurisdiction;
  readonly key: string;
  readonly value: TValue;
  readonly recordedAt: IsoTimestamp;
  readonly expiresAt: IsoTimestamp | null;
}

// ─────────────────────────────────────────────────────────────────────
// Ports — pluggable adapters injected at composition root
// ─────────────────────────────────────────────────────────────────────

/** Embedder port — supply OpenAI/Anthropic/local model adapter. */
export interface Embedder {
  embed(text: string): Promise<ReadonlyArray<number>>;
}

/**
 * Brain port — supply Claude/OpenAI/Anthropic LLM adapter used for
 * reflective summarisation. Optional — pass `null` to disable reflection.
 */
export interface Brain {
  summarise(
    transcript: ReadonlyArray<{ role: string; content: string }>,
    systemPrompt: string,
  ): Promise<string>;
}

/** Episodic store port — persistence for episodes + facts. */
export interface EpisodicStore {
  upsertEpisode(ep: Episode): Promise<Episode>;
  recordFact(fact: EpisodeFact): Promise<EpisodeFact>;
  listFactsForEpisode(episodeId: Id): Promise<ReadonlyArray<EpisodeFact>>;
  retrieveByRelevance(
    query: EpisodeRetrievalQuery,
  ): Promise<ReadonlyArray<EpisodeWithScore>>;
}

/** Narrative store port. */
export interface NarrativeStore {
  upsertArc(arc: NarrativeArc): Promise<NarrativeArc>;
  listArcsForTenant(
    tenantId: TenantId,
    limit?: number,
  ): Promise<ReadonlyArray<NarrativeArc>>;
}

/** Procedural store port. */
export interface ProceduralStore {
  recordSkill(skill: ProceduralSkill): Promise<ProceduralSkill>;
  getPromotedSkills(
    tenantId: TenantId,
    limit?: number,
  ): Promise<ReadonlyArray<ProceduralSkill>>;
  findByName(
    tenantId: TenantId,
    name: string,
  ): Promise<ProceduralSkill | null>;
}

/** Reflective store port. */
export interface ReflectiveStore {
  upsertNote(note: ReflectiveNote): Promise<ReflectiveNote>;
  getLatestForTenant(tenantId: TenantId): Promise<ReflectiveNote | null>;
}

/** Topic-files store port. */
export interface TopicFileStore {
  upsertTopic(file: TopicFile): Promise<TopicFile>;
  getByTopic(
    tenantId: TenantId,
    topic: string,
  ): Promise<TopicFile | null>;
}

/** Cohort cache store port. */
export interface CohortCacheStore {
  get<TValue>(
    tenantId: TenantId,
    jurisdiction: Jurisdiction,
    key: string,
  ): Promise<CohortCacheEntry<TValue> | null>;
  set<TValue>(entry: CohortCacheEntry<TValue>): Promise<void>;
  invalidate(
    tenantId: TenantId,
    jurisdiction: Jurisdiction,
    keyPrefix?: string,
  ): Promise<void>;
}

/** Composition root inputs. */
export interface MemoryV2Stores {
  readonly episodic: EpisodicStore;
  readonly narrative: NarrativeStore;
  readonly procedural: ProceduralStore;
  readonly reflective: ReflectiveStore;
  readonly topics: TopicFileStore;
  readonly cohort: CohortCacheStore;
}

export interface MemoryV2Options {
  readonly stores: MemoryV2Stores;
  readonly embedder?: Embedder;
  readonly brain?: Brain;
}

/** Unified API returned by `createMemoryV2`. */
export interface MemoryV2 {
  readonly stores: MemoryV2Stores;
  readonly embedder: Embedder | null;
  readonly brain: Brain | null;
}

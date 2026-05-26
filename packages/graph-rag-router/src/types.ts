/**
 * `@borjie/graph-rag-router` — types.
 *
 * Companion to `Docs/DESIGN/GRAPH_RAG_ROUTER_SPEC.md`. These types
 * are the public contract surface; everything in the implementation
 * folders depends on names defined here. Implementations are
 * port-and-adapter throughout (no I/O, no DB calls).
 */

/** ISO-8601 timestamp string. */
export type IsoTimestamp = string;

/** UUID-ish identifier. */
export type Id = string;

/** A retrieval mode the router can pick for a given query. */
export type RetrievalMode =
  | 'vector'
  | 'graph_local'
  | 'graph_global'
  | 'hybrid';

/** Per-query routing decision. Human-auditable. */
export interface RouteDecision {
  readonly mode: RetrievalMode;
  /** Short, explanatory reason (printable in audit logs). */
  readonly reason: string;
  /** 0..1 — classifier's confidence in the chosen mode. */
  readonly confidence: number;
  /** Optional axis scores (for observability / regression-testing). */
  readonly scores?: {
    readonly entityDensity: number;
    readonly relationalKeywords: number;
    readonly aggregationKeywords: number;
    readonly specificity: number;
  };
}

/** Context passed to the router on every query. */
export interface QueryContext {
  readonly tenantId: string;
  readonly scopeId?: string;
  /** Optional caller hint — if set, skips classification entirely. */
  readonly forceMode?: RetrievalMode;
  /** Soft cap on number of chunks to return. */
  readonly topK?: number;
}

/** A single retrieved chunk — the unit returned to the caller. */
export interface RetrievedChunk {
  readonly id: Id;
  readonly text: string;
  readonly score: number;
  /** 'vector' | 'graph_local' | 'graph_global' — which backend produced it. */
  readonly source: Exclude<RetrievalMode, 'hybrid'>;
  /** Optional list of entity ids that justified surfacing this chunk. */
  readonly viaEntityIds?: ReadonlyArray<Id>;
}

// ---------------------------------------------------------------------------
// Entity / relation extraction
// ---------------------------------------------------------------------------

export type EntityType =
  | 'person'
  | 'org'
  | 'place'
  | 'concept'
  | 'asset'
  | 'event'
  | 'other';

export interface ExtractedEntity {
  readonly name: string;
  readonly type: EntityType;
  readonly description: string;
}

export interface ExtractedRelation {
  readonly from: string; // entity name
  readonly to: string;
  readonly kind: string;
  readonly description: string;
}

export interface ExtractionResult {
  readonly entities: ReadonlyArray<ExtractedEntity>;
  readonly relations: ReadonlyArray<ExtractedRelation>;
}

/**
 * Port for LLM-driven entity extraction. Implementations call an
 * LLM (or any other extractor) and return canonicalised entities.
 * The router never calls the LLM directly — only through this port.
 */
export interface EntityExtractorPort {
  extract(text: string): Promise<ReadonlyArray<ExtractedEntity>>;
}

export interface RelationExtractorPort {
  extract(
    text: string,
    entities: ReadonlyArray<ExtractedEntity>,
  ): Promise<ReadonlyArray<ExtractedRelation>>;
}

// ---------------------------------------------------------------------------
// Graph + communities
// ---------------------------------------------------------------------------

export interface GraphNode {
  readonly id: Id;
  readonly name: string;
  readonly type: EntityType;
  readonly description: string;
}

export interface GraphEdge {
  readonly id: Id;
  readonly fromId: Id;
  readonly toId: Id;
  readonly kind: string;
  readonly weight: number;
}

export interface KnowledgeGraph {
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly edges: ReadonlyArray<GraphEdge>;
}

export interface Community {
  readonly id: Id;
  readonly level: number;
  readonly parentCommunityId: Id | null;
  readonly memberEntityIds: ReadonlyArray<Id>;
  readonly signatureHash: string;
}

export interface CommunitySummary {
  readonly id: Id;
  readonly communityId: Id;
  readonly summaryMd: string;
  readonly tokenCount: number;
  readonly modelId: string;
  readonly signatureHash: string;
  readonly generatedAt: IsoTimestamp;
}

/** Port for summarising a community via an LLM. */
export interface CommunitySummariserPort {
  summarise(args: {
    readonly community: Community;
    readonly nodes: ReadonlyArray<GraphNode>;
    readonly edges: ReadonlyArray<GraphEdge>;
  }): Promise<{ readonly summaryMd: string; readonly tokenCount: number }>;
}

// ---------------------------------------------------------------------------
// Storage ports
// ---------------------------------------------------------------------------

export interface EntityRepositoryPort {
  upsert(args: {
    readonly tenantId: string;
    readonly entity: ExtractedEntity;
  }): Promise<GraphNode>;
  list(tenantId: string): Promise<ReadonlyArray<GraphNode>>;
}

export interface RelationRepositoryPort {
  upsert(args: {
    readonly tenantId: string;
    readonly fromId: Id;
    readonly toId: Id;
    readonly relation: ExtractedRelation;
  }): Promise<GraphEdge>;
  list(tenantId: string): Promise<ReadonlyArray<GraphEdge>>;
}

export interface CommunityRepositoryPort {
  upsertCommunity(args: {
    readonly tenantId: string;
    readonly community: Community;
  }): Promise<void>;
  upsertSummary(args: {
    readonly tenantId: string;
    readonly summary: CommunitySummary;
  }): Promise<void>;
  listCommunities(tenantId: string): Promise<ReadonlyArray<Community>>;
  getLatestSummary(args: {
    readonly tenantId: string;
    readonly communityId: Id;
  }): Promise<CommunitySummary | null>;
}

// ---------------------------------------------------------------------------
// Retrieval backends
// ---------------------------------------------------------------------------

export interface VectorBackendPort {
  retrieve(args: {
    readonly tenantId: string;
    readonly query: string;
    readonly topK: number;
  }): Promise<ReadonlyArray<RetrievedChunk>>;
}

export interface GraphBackendPort {
  retrieveLocal(args: {
    readonly tenantId: string;
    readonly query: string;
    readonly topK: number;
  }): Promise<ReadonlyArray<RetrievedChunk>>;
  retrieveGlobal(args: {
    readonly tenantId: string;
    readonly query: string;
    readonly topK: number;
  }): Promise<ReadonlyArray<RetrievedChunk>>;
}

// ---------------------------------------------------------------------------
// Router public surface
// ---------------------------------------------------------------------------

export interface RouterPort {
  classify(query: string, ctx: QueryContext): RouteDecision;
  retrieve(
    query: string,
    decision: RouteDecision,
    ctx: QueryContext,
  ): Promise<ReadonlyArray<RetrievedChunk>>;
}

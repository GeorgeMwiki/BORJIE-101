/**
 * `@borjie/graph-rag-router` — public surface.
 *
 * Hierarchical retrieval substrate. Closes the founder-flagged P0
 * gap from the 18BB analysis. See `Docs/DESIGN/GRAPH_RAG_ROUTER_SPEC.md`.
 *
 * Re-exports the entity / relation extractors, graph builder,
 * community detector, summary generator, query classifier, hybrid
 * retriever, and the in-memory repositories used as reference
 * implementations of the storage ports.
 *
 * ---------------------------------------------------------------------
 * CANONICAL RETRIEVAL PATH (KI-graphrag) — read before wiring this in
 * ---------------------------------------------------------------------
 * Borjie ran with TWO graph stacks: this `graph-rag-router` and the
 * `@borjie/knowledge-graph` package. To remove the ambiguity the audit
 * flagged, the canonical paths are now declared:
 *
 *   1. LIVE per-turn retrieval (the request path the chat orchestrator
 *      hits on every consequential turn) = the pgvector ANN over
 *      `intelligence_corpus_chunks`, implemented in
 *      `services/api-gateway/src/routes/mining/chat-corpus-evidence.ts`
 *      (cosine `<=>` against the `vector_cosine_ops` hnsw index), with
 *      the wired `@borjie/knowledge-graph` ontology providing entity-
 *      graph context. This is the low-latency, always-on grounding path.
 *
 *   2. OFFLINE hierarchical / global GraphRAG (community detection +
 *      map-reduce community summaries for whole-corpus "global" questions)
 *      = THIS package, reached via the sleep-pass orchestrator
 *      (`services/sleep-pass-orchestrator/src/passes/
 *      graph-rag-community-summaries.ts`). It is intentionally NOT on the
 *      synchronous request path — community detection + summarisation is a
 *      batch workload that belongs in the nightly consolidation pass, not
 *      a per-turn round-trip.
 *
 * So this router is NOT an orphan to be deleted; it is the reference /
 * offline tier of a two-tier design. A future PR that wants live global-
 * GraphRAG answers should bridge the sleep-pass community summaries into
 * `chat-corpus-evidence.ts` as an ADDITIONAL evidence source (append, do
 * not replace the pgvector path), keyed off the query classifier's
 * "global vs local" `RouteDecision` already exported below.
 */

export type {
  Community,
  CommunityRepositoryPort,
  CommunitySummariserPort,
  CommunitySummary,
  EntityExtractorPort,
  EntityRepositoryPort,
  EntityType,
  ExtractedEntity,
  ExtractedRelation,
  ExtractionResult,
  GraphBackendPort,
  GraphEdge,
  GraphNode,
  Id,
  IsoTimestamp,
  KnowledgeGraph,
  QueryContext,
  RelationExtractorPort,
  RelationRepositoryPort,
  RetrievalMode,
  RetrievedChunk,
  RouteDecision,
  RouterPort,
  VectorBackendPort,
} from './types.js';

export {
  canonicaliseEntities,
  extractEntities,
} from './extraction/entity-extractor.js';
export {
  extractRelations,
  filterRelations,
} from './extraction/relation-extractor.js';

export {
  buildGraph,
  edgeId,
  entityIdFromName,
} from './graph/graph-builder.js';
export {
  detectCommunities,
  signatureHash,
} from './graph/community-detector.js';
export {
  summariseCommunity,
  summaryId,
} from './graph/summary-generator.js';

export {
  aggregationKeywordScore,
  classifyQuery,
  entityDensity,
  relationalKeywordScore,
  specificityScore,
} from './routing/query-classifier.js';
export {
  createRouter,
  reciprocalRankFuse,
} from './routing/hybrid-retriever.js';

export {
  createInMemoryEntityRepository,
  seedInMemoryEntities,
} from './storage/entity-repository.js';
export { createInMemoryRelationRepository } from './storage/relation-repository.js';
export { createInMemoryCommunityRepository } from './storage/community-repository.js';

export {
  hashCommunityRow,
  hashEntityRow,
  hashRelationRow,
  hashSummaryRow,
} from './audit/audit-chain-link.js';

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

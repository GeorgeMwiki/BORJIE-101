/**
 * @borjie/graph-sync
 *
 * Canonical Property Graph (CPG) — Neo4j integration for Borjie
 *
 * Provides:
 *  - Neo4j client with connection management
 *  - CPG schema (node labels, relationship types, constraints)
 *  - ETL sync engine (PostgreSQL → Neo4j)
 *  - GraphQueryService (AI agent query interface)
 */

// ─── Client ──────────────────────────────────────────────────────────────────
export {
  Neo4jClient,
  Neo4jConfigSchema,
  type Neo4jConfig,
  createNeo4jClient,
  getDefaultNeo4jClient,
  closeDefaultNeo4jClient,
} from './client/neo4j-client.js';

// ─── Tenant-scoped Cypher helpers ────────────────────────────────────────────
// Re-exported from the public barrel so consumers can import the
// tenant-isolation primitives without reaching into deep paths.
export {
  assertCypherReferencesTenantId,
  createTenantScopedCypher,
  scopeNodePattern,
  TenantScopeViolation,
  type TenantScopedParams,
  type TenantScopedCypherClient,
  type TenantScopedCypherDeps,
  type Neo4jReadClient,
  type Neo4jWriteClient,
} from './client/tenant-scoped-cypher.js';

// ─── Schema ──────────────────────────────────────────────────────────────────
export {
  ALL_NODE_LABELS,
  ORG_LABELS,
  PROPERTY_LABELS,
  PEOPLE_LABELS,
  CONTRACT_LABELS,
  OPS_LABELS,
  FINANCE_LABELS,
  LEGAL_LABELS,
  MARKET_LABELS,
  TIMELINE_LABELS,
  type NodeLabel,
  type BaseNodeProperties,
} from './schema/node-labels.js';

export {
  ALL_RELATIONSHIP_TYPES,
  ORG_RELATIONSHIPS,
  PROPERTY_HIERARCHY_RELATIONSHIPS,
  LAND_HIERARCHY_RELATIONSHIPS,
  PEOPLE_RELATIONSHIPS,
  CONTRACT_RELATIONSHIPS,
  DOCUMENT_RELATIONSHIPS,
  OPS_RELATIONSHIPS,
  FINANCE_RELATIONSHIPS,
  CREDIT_RELATIONSHIPS,
  LEGAL_RELATIONSHIPS,
  MARKET_RELATIONSHIPS,
  TIMELINE_RELATIONSHIPS,
  type RelationshipType,
  type BaseEdgeProperties,
} from './schema/relationship-types.js';

export {
  applyConstraintsAndIndexes,
  UNIQUENESS_CONSTRAINTS,
  PERFORMANCE_INDEXES,
  FULLTEXT_INDEXES,
  type ApplyConstraintsResult,
} from './schema/constraints.js';

// ─── Sync Engine ─────────────────────────────────────────────────────────────
export {
  GraphSyncEngine,
  createGraphSyncEngine,
  type SyncEvent,
  type SyncResult,
  type NodeSyncPayload,
  type RelationshipSyncPayload,
} from './sync/graph-sync-engine.js';

// ─── Query Service ───────────────────────────────────────────────────────────
export {
  GraphQueryService,
  createGraphQueryService,
  type CaseTimelineEntry,
  type TenantRiskDriver,
  type TenantRiskProfile,
  type VendorScorecardEntry,
  type UnitHealthReport,
  type ParcelComplianceReport,
  type PropertyRollup,
  type EvidencePackResult,
  type GraphEvidencePath,
  type NaturalLanguageQueryResult,
} from './queries/graph-query-service.js';

// ─── Batch Sync ──────────────────────────────────────────────────────────────
export {
  runBatchSync,
  type BatchSyncConfig,
  type BatchSyncResult,
  type DataFetcher,
} from './sync/batch-sync.js';

// ─── AI Agent Tool Interface ─────────────────────────────────────────────────
export {
  GraphAgentToolkit,
  createGraphAgentToolkit,
  type GraphToolDefinition,
  type GraphToolResult,
} from './queries/graph-agent-toolkit.js';

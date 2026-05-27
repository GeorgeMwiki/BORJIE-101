/**
 * `@borjie/graph-database` — public barrel.
 *
 * Headline consumer:
 *
 *   const registry = createDriverRegistry({
 *     drivers: {
 *       neo4j: createNeo4jDriver({ fetcher: myNeo4jFetcher }),
 *       falkordb: createFalkorDriver({ fetcher: myFalkorFetcher }),
 *       apache_age: createApacheAgeDriver({ fetcher: myPgFetcher }),
 *     },
 *   });
 *
 *   const query = licencePermitHierarchy({ tenantId: 'tnt-x' });
 *   const result = await registry.run(query);
 *
 * Spec: Docs/DESIGN/GRAPH_DATABASE_SOTA_2026.md.
 * Persona: Mr. Mwikila.
 *
 * @module @borjie/graph-database
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export {
  GRAPH_DRIVERS,
  GraphDatabaseError,
  type ConnectionConfig,
  type CypherQuery,
  type GraphDatabaseErrorCode,
  type GraphDriverId,
  type GraphDriverPort,
  type GraphEdge,
  type GraphNode,
  type GraphResult,
  type GraphResultRecord,
  type QueryPlan,
} from './types.js';

// ---------------------------------------------------------------------------
// Query builders + guards
// ---------------------------------------------------------------------------

export {
  CypherBuilder,
  cypher,
  type CypherBuilderState,
  type CypherClauseKind,
} from './query/cypher-builder.js';

export {
  assertTenantScopedQuery,
  wrapTenantScopedQuery,
  type WrapTenantScopedQueryArgs,
} from './query/tenant-scoped-query.js';

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

export {
  createNeo4jDriver,
  type CreateNeo4jDriverArgs,
  type Neo4jSessionFetcher,
} from './drivers/neo4j-driver.js';

export {
  createFalkorDriver,
  type CreateFalkorDriverArgs,
  type FalkorGraphFetcher,
} from './drivers/falkordb-driver.js';

export {
  createApacheAgeDriver,
  wrapCypherForAge,
  type CreateApacheAgeDriverArgs,
  type PgQueryFetcher,
} from './drivers/apache-age-driver.js';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export {
  createDriverRegistry,
  type DriverRegistry,
  type DriverRegistryDeps,
} from './driver-registry.js';

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

export {
  createInMemoryMigrationLog,
  createMigrationManager,
  type CreateMigrationManagerArgs,
  type CypherMigration,
  type MigrationLogPort,
  type MigrationLogRecord,
  type MigrationManager,
} from './schema/migration-manager.js';

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export {
  createInMemoryGraphRunRepository,
  createSqlGraphRunRepository,
  type GraphRunRecord,
  type GraphRunRepository,
  type InMemoryGraphRunRepoDeps,
  type InsertGraphRunInput,
  type SqlGraphRunDriver,
  type SqlGraphRunRepoDeps,
} from './repositories/graph-run-repository.js';

// ---------------------------------------------------------------------------
// Domain wrappers
// ---------------------------------------------------------------------------

export {
  buyerNetwork,
  licencePermitHierarchy,
  MINING_LABELS,
  MINING_REL_TYPES,
  supplyChainProvenance,
  workerCertificationGraph,
  type BuyerNetworkArgs,
  type LicencePermitHierarchyArgs,
  type SupplyChainProvenanceArgs,
  type WorkerCertificationGraphArgs,
} from './domain/mining-graph.js';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export {
  buildGraphDatabaseLogger,
  type GraphDatabaseLoggerOptions,
} from './logger.js';

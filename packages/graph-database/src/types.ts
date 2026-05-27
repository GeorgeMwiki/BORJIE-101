/**
 * `@borjie/graph-database` — public type surface.
 *
 * The package is driver-agnostic. Every backend (Neo4j 5, FalkorDB,
 * Apache AGE) implements `GraphDriverPort` and consumes
 * `CypherQuery` values produced by the typed `CypherBuilder`.
 *
 * Persona: Mr. Mwikila. Spec: Docs/DESIGN/GRAPH_DATABASE_SOTA_2026.md.
 *
 * @module @borjie/graph-database/types
 */

// ---------------------------------------------------------------------------
// Driver identification
// ---------------------------------------------------------------------------

export const GRAPH_DRIVERS = ['neo4j', 'falkordb', 'apache_age'] as const;
export type GraphDriverId = (typeof GRAPH_DRIVERS)[number];

// ---------------------------------------------------------------------------
// Connection config
// ---------------------------------------------------------------------------

export interface ConnectionConfig {
  readonly driver: GraphDriverId;
  /** Connection URI. neo4j:// for Neo4j, redis:// for FalkorDB,
      postgres:// for Apache AGE. */
  readonly uri: string;
  readonly username?: string;
  readonly password?: string;
  /** Per-driver options bag. Validated by the driver itself. */
  readonly options?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Property graph primitives
// ---------------------------------------------------------------------------

/**
 * Property-graph node. `tenantId` is always required so the
 * tenant-isolation invariant can be enforced from the schema up.
 */
export interface GraphNode {
  readonly id: string;
  readonly tenantId: string;
  readonly labels: ReadonlyArray<string>;
  readonly properties: Readonly<Record<string, unknown>>;
}

/**
 * Property-graph edge. `tenantId` is required for the same reason
 * as `GraphNode`; cross-tenant edges are explicitly forbidden.
 */
export interface GraphEdge {
  readonly id: string;
  readonly tenantId: string;
  readonly type: string;
  readonly fromId: string;
  readonly toId: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Cypher query payloads
// ---------------------------------------------------------------------------

/**
 * A fully built, tenant-scoped Cypher query. Carries the raw Cypher
 * string, the parameter map, the originating tenant, and metadata
 * the driver registry needs (driver hint, read-only flag).
 *
 * Constructed exclusively via `CypherBuilder.build()`. The driver
 * port rejects any query whose `tenantScoped` flag is false.
 */
export interface CypherQuery {
  readonly cypher: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly tenantId: string;
  readonly tenantScoped: true;
  readonly readOnly: boolean;
  /** Optional preferred driver. When unset the registry picks per
      latency budget and availability. */
  readonly preferredDriver?: GraphDriverId;
}

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface GraphResultRecord {
  readonly fields: ReadonlyArray<string>;
  readonly values: ReadonlyArray<unknown>;
}

export interface GraphResult {
  readonly driver: GraphDriverId;
  readonly tenantId: string;
  readonly records: ReadonlyArray<GraphResultRecord>;
  readonly latencyMs: number;
}

// ---------------------------------------------------------------------------
// Driver port — every backend implements this
// ---------------------------------------------------------------------------

export interface GraphDriverPort {
  readonly id: GraphDriverId;
  readonly run: (query: CypherQuery) => Promise<GraphResult>;
  readonly healthCheck: () => Promise<{
    readonly ok: boolean;
    readonly latencyMs: number;
    readonly message?: string;
  }>;
  readonly close: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Query plan — for driver routing
// ---------------------------------------------------------------------------

export interface QueryPlan {
  readonly driver: GraphDriverId;
  readonly estimatedLatencyMs: number;
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type GraphDatabaseErrorCode =
  | 'tenant_scope_missing'
  | 'driver_unavailable'
  | 'invalid_cypher'
  | 'parameter_validation_failed'
  | 'migration_failed'
  | 'unauthorized_tenant';

export class GraphDatabaseError extends Error {
  public readonly code: GraphDatabaseErrorCode;
  public readonly context: Readonly<Record<string, unknown>>;

  constructor(
    code: GraphDatabaseErrorCode,
    message: string,
    context: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'GraphDatabaseError';
    this.code = code;
    this.context = context;
  }
}

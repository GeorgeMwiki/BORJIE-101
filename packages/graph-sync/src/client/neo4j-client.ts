/**
 * Neo4j Client — Connection management for the Canonical Property Graph
 *
 * Wraps the Neo4j JavaScript driver with:
 *  - Connection pooling
 *  - Health checks
 *  - Tenant-scoped session factory
 *  - Graceful shutdown
 */

import neo4j, { Driver, Session, ManagedTransaction } from 'neo4j-driver';
import { z } from 'zod';
import {
  assertCypherReferencesTenantId,
  TenantScopeViolation,
  type TenantScopedParams,
} from './tenant-scoped-cypher.js';

// ─── Configuration ───────────────────────────────────────────────────────────

export const DEFAULT_DEV_PASSWORD = 'borjie_graph_dev';
export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
]);
export const BOLT_SCHEMES: ReadonlySet<string> = new Set([
  'bolt:',
  'bolt+s:',
  'bolt+ssc:',
  'neo4j:',
  'neo4j+s:',
  'neo4j+ssc:',
]);

export const Neo4jConfigSchema = z.object({
  uri: z.string().default('bolt://localhost:7687'),
  username: z.string().default('neo4j'),
  password: z.string().default(DEFAULT_DEV_PASSWORD),
  database: z.string().default('neo4j'),
  maxConnectionPoolSize: z.number().default(50),
  connectionAcquisitionTimeoutMs: z.number().default(30000),
  connectionTimeoutMs: z.number().default(10000),
  maxTransactionRetryTimeMs: z.number().default(30000),
  encrypted: z.boolean().default(false),
});

export type Neo4jConfig = z.infer<typeof Neo4jConfigSchema>;

/**
 * Returns true when the given URI targets a loopback address (safe for
 * default development credentials). Falls back to "remote" semantics for
 * any URI we cannot parse — fail-closed.
 */
export function isLoopbackNeo4jUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    if (!BOLT_SCHEMES.has(parsed.protocol)) {
      // Non-bolt scheme: treat as remote so we still require explicit creds.
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return LOOPBACK_HOSTS.has(host);
  } catch {
    return false;
  }
}

/**
 * Runtime defence-in-depth check for `tenantId` in params. Mirrors the
 * stricter helper inside `tenant-scoped-cypher.ts` but lives here so the
 * `Neo4jClient.readQuery` / `writeQuery` data-plane methods don't depend
 * on the wrapper module to enforce the gate.
 */
function assertTenantIdRuntime(params: Record<string, unknown>): void {
  const tenantId = params.tenantId;
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    throw new TenantScopeViolation(
      'Neo4jClient: params.tenantId is required and must be a non-empty string',
    );
  }
}

/**
 * Enforces that a remote Neo4j endpoint never relies on the built-in
 * development password. Throws NEO4J_PASSWORD_REQUIRED otherwise.
 */
export function assertRemoteNeo4jHasPassword(config: Neo4jConfig): void {
  if (isLoopbackNeo4jUri(config.uri)) {
    return;
  }
  const trimmed = config.password?.trim() ?? '';
  if (trimmed.length === 0 || trimmed === DEFAULT_DEV_PASSWORD) {
    const err = new Error(
      'NEO4J_PASSWORD_REQUIRED: Non-loopback Neo4j URI requires an explicit ' +
        'NEO4J_PASSWORD that is not the default development credential.'
    );
    (err as Error & { code?: string }).code = 'NEO4J_PASSWORD_REQUIRED';
    throw err;
  }
}

// ─── Client Class ────────────────────────────────────────────────────────────

export class Neo4jClient {
  private driver: Driver;
  private config: Neo4jConfig;
  private isConnected = false;

  constructor(config: Partial<Neo4jConfig> = {}) {
    this.config = Neo4jConfigSchema.parse(config);
    assertRemoteNeo4jHasPassword(this.config);

    this.driver = neo4j.driver(
      this.config.uri,
      neo4j.auth.basic(this.config.username, this.config.password),
      {
        maxConnectionPoolSize: this.config.maxConnectionPoolSize,
        connectionAcquisitionTimeout: this.config.connectionAcquisitionTimeoutMs,
        connectionTimeout: this.config.connectionTimeoutMs,
        maxTransactionRetryTime: this.config.maxTransactionRetryTimeMs,
        encrypted: this.config.encrypted ? 'ENCRYPTION_ON' : 'ENCRYPTION_OFF',
      }
    );
  }

  /**
   * Verify connectivity to Neo4j
   */
  async verifyConnectivity(): Promise<boolean> {
    try {
      await this.driver.verifyConnectivity();
      this.isConnected = true;
      return true;
    } catch {
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Health check with server info
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    serverVersion?: string;
    database?: string;
    error?: string;
  }> {
    try {
      const serverInfo = await this.driver.getServerInfo();
      const serverVersion = serverInfo.protocolVersion?.toString();
      return {
        healthy: true,
        ...(serverVersion != null ? { serverVersion } : {}),
        database: this.config.database,
      };
    } catch (err) {
      return {
        healthy: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Get a read session (for queries)
   */
  readSession(database?: string): Session {
    return this.driver.session({
      defaultAccessMode: neo4j.session.READ,
      database: database ?? this.config.database,
    });
  }

  /**
   * Get a write session (for mutations)
   */
  writeSession(database?: string): Session {
    return this.driver.session({
      defaultAccessMode: neo4j.session.WRITE,
      database: database ?? this.config.database,
    });
  }

  /**
   * Execute a tenant-scoped read query with automatic session management.
   *
   * TENANT ISOLATION (type-level + runtime):
   *   - `params` MUST satisfy `TenantScopedParams<P>` — i.e. carry a
   *     non-empty `tenantId: string`. Forgetting it is a TypeScript
   *     compile error.
   *   - The Cypher MUST reference `$tenantId` at least once. The runtime
   *     guard `assertCypherReferencesTenantId` throws
   *     `TenantScopeViolation` BEFORE the driver opens a session, so a
   *     malformed query never reaches Neo4j.
   *
   * For admin / schema-management queries that legitimately don't carry
   * a tenant (e.g. CREATE CONSTRAINT, CREATE INDEX) use `runSchemaQuery`.
   */
  async readQuery<
    T = Record<string, unknown>,
    P extends Record<string, unknown> = Record<string, unknown>,
  >(
    cypher: string,
    params: TenantScopedParams<P>,
    database?: string
  ): Promise<T[]> {
    assertCypherReferencesTenantId(cypher);
    assertTenantIdRuntime(params);
    const session = this.readSession(database);
    try {
      const result = await session.run(cypher, params as Record<string, unknown>);
      return result.records.map((record: { toObject(): unknown }) => record.toObject() as T);
    } finally {
      await session.close();
    }
  }

  /**
   * Execute a tenant-scoped write query with automatic session
   * management. Same tenant-isolation rules as {@link readQuery}.
   */
  async writeQuery<
    T = Record<string, unknown>,
    P extends Record<string, unknown> = Record<string, unknown>,
  >(
    cypher: string,
    params: TenantScopedParams<P>,
    database?: string
  ): Promise<T[]> {
    assertCypherReferencesTenantId(cypher);
    assertTenantIdRuntime(params);
    const session = this.writeSession(database);
    try {
      const result = await session.run(cypher, params as Record<string, unknown>);
      return result.records.map((record: { toObject(): unknown }) => record.toObject() as T);
    } finally {
      await session.close();
    }
  }

  /**
   * Execute an admin-only schema-management query (CREATE CONSTRAINT,
   * CREATE INDEX, DROP INDEX, SHOW INDEXES, etc.).
   *
   * SECURITY MODEL:
   *   - Schema DDL is a global-namespace operation in Neo4j — it cannot
   *     be tenant-scoped, by design.
   *   - This method intentionally BYPASSES the `$tenantId` guard.
   *   - DO NOT use this for data-plane reads/writes. Use `readQuery` /
   *     `writeQuery` for anything that touches tenant nodes.
   *   - Callers should be exclusively the schema bootstrap module
   *     (`schema/constraints.ts`) and operator scripts.
   */
  async runSchemaQuery<T = Record<string, unknown>>(
    cypher: string,
    database?: string
  ): Promise<T[]> {
    const session = this.writeSession(database);
    try {
      const result = await session.run(cypher);
      return result.records.map((record: { toObject(): unknown }) => record.toObject() as T);
    } finally {
      await session.close();
    }
  }

  /**
   * Execute a write transaction (with retry logic)
   */
  async writeTransaction<T>(
    work: (tx: ManagedTransaction) => Promise<T>,
    database?: string
  ): Promise<T> {
    const session = this.writeSession(database);
    try {
      return await session.executeWrite(work);
    } finally {
      await session.close();
    }
  }

  /**
   * Execute a read transaction (with retry logic)
   */
  async readTransaction<T>(
    work: (tx: ManagedTransaction) => Promise<T>,
    database?: string
  ): Promise<T> {
    const session = this.readSession(database);
    try {
      return await session.executeRead(work);
    } finally {
      await session.close();
    }
  }

  /**
   * Get the underlying driver (for advanced use cases)
   */
  getDriver(): Driver {
    return this.driver;
  }

  /**
   * Check if client is connected
   */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Graceful shutdown
   */
  async close(): Promise<void> {
    await this.driver.close();
    this.isConnected = false;
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

let defaultClient: Neo4jClient | null = null;

/**
 * Create a Neo4j client from environment variables or explicit config.
 * In production, NEO4J_URI must be set. In ALL environments, any non-loopback
 * URI must supply NEO4J_PASSWORD that is not the default dev credential
 * (enforced inside the Neo4jClient constructor).
 */
export function createNeo4jClient(config?: Partial<Neo4jConfig>): Neo4jClient {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.NEO4J_URI?.trim()) {
      throw new Error('NEO4J_URI is required in production');
    }
  }
  const envConfig: Partial<Neo4jConfig> = {};
  if (process.env.NEO4J_URI != null) envConfig.uri = process.env.NEO4J_URI;
  if (process.env.NEO4J_USER != null) envConfig.username = process.env.NEO4J_USER;
  if (process.env.NEO4J_PASSWORD != null) envConfig.password = process.env.NEO4J_PASSWORD;
  if (process.env.NEO4J_DATABASE != null) envConfig.database = process.env.NEO4J_DATABASE;

  return new Neo4jClient({ ...envConfig, ...config });
}

/**
 * Get or create the default Neo4j client (singleton)
 */
export function getDefaultNeo4jClient(): Neo4jClient {
  if (!defaultClient) {
    defaultClient = createNeo4jClient();
  }
  return defaultClient;
}

/**
 * Close the default client (for graceful shutdown)
 */
export async function closeDefaultNeo4jClient(): Promise<void> {
  if (defaultClient) {
    await defaultClient.close();
    defaultClient = null;
  }
}

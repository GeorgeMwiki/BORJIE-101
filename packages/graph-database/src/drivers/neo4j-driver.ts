/**
 * Neo4j 5 driver adapter for `@borjie/graph-database`.
 *
 * Lazy-loads `neo4j-driver` (peer dependency, optional) so this
 * package can be installed in edge runtimes where the native driver
 * is not available.
 *
 * The runtime driver is supplied by the host composition root via
 * the `Neo4jSessionFetcher` port. Tests pass a clearly labelled
 * mock fetcher.
 *
 * @module @borjie/graph-database/drivers/neo4j-driver
 */

import {
  GraphDatabaseError,
  type CypherQuery,
  type GraphDriverPort,
  type GraphResult,
  type GraphResultRecord,
} from '../types.js';
import { assertTenantScopedQuery } from '../query/tenant-scoped-query.js';

// ---------------------------------------------------------------------------
// Port — host wires this in
// ---------------------------------------------------------------------------

export interface Neo4jSessionFetcher {
  readonly run: (
    cypher: string,
    params: Readonly<Record<string, unknown>>,
  ) => Promise<{
    readonly records: ReadonlyArray<{
      readonly keys: ReadonlyArray<string>;
      readonly get: (key: string) => unknown;
    }>;
  }>;
  readonly close: () => Promise<void>;
  readonly verifyConnectivity?: () => Promise<void>;
}

export interface CreateNeo4jDriverArgs {
  readonly fetcher: Neo4jSessionFetcher;
  readonly now?: () => number;
}

/**
 * Build a `GraphDriverPort` backed by a Neo4j session. The fetcher
 * is injected by the composition root — this package does not
 * `import 'neo4j-driver'` at load time.
 */
export function createNeo4jDriver(args: CreateNeo4jDriverArgs): GraphDriverPort {
  if (!args.fetcher) {
    throw new GraphDatabaseError(
      'driver_unavailable',
      'createNeo4jDriver requires a Neo4jSessionFetcher',
    );
  }
  const now = args.now ?? (() => Date.now());

  return {
    id: 'neo4j',
    async run(query: CypherQuery): Promise<GraphResult> {
      assertTenantScopedQuery(query);
      const startedAt = now();
      let raw;
      try {
        raw = await args.fetcher.run(query.cypher, query.params);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new GraphDatabaseError(
          'driver_unavailable',
          `neo4j run failed: ${message}`,
          { cypher: query.cypher },
        );
      }
      const records: ReadonlyArray<GraphResultRecord> = raw.records.map((r) => ({
        fields: r.keys,
        values: r.keys.map((k) => r.get(k)),
      }));
      const latencyMs = Math.max(0, now() - startedAt);
      return {
        driver: 'neo4j',
        tenantId: query.tenantId,
        records,
        latencyMs,
      };
    },
    async healthCheck() {
      const startedAt = now();
      try {
        if (args.fetcher.verifyConnectivity) {
          await args.fetcher.verifyConnectivity();
        }
        return {
          ok: true,
          latencyMs: Math.max(0, now() - startedAt),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          latencyMs: Math.max(0, now() - startedAt),
          message,
        };
      }
    },
    async close(): Promise<void> {
      await args.fetcher.close();
    },
  };
}

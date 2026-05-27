/**
 * FalkorDB driver adapter for `@borjie/graph-database`.
 *
 * FalkorDB is a Redis module exposing `GRAPH.QUERY` with a Cypher-
 * compatible dialect. We lazy-load the `falkordb` client through a
 * `FalkorGraphFetcher` port — the host composition root supplies
 * the actual client.
 *
 * @module @borjie/graph-database/drivers/falkordb-driver
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

export interface FalkorGraphFetcher {
  readonly query: (
    cypher: string,
    params: Readonly<Record<string, unknown>>,
  ) => Promise<{
    readonly header: ReadonlyArray<string>;
    readonly data: ReadonlyArray<ReadonlyArray<unknown>>;
  }>;
  readonly close: () => Promise<void>;
  readonly ping?: () => Promise<'PONG' | string>;
}

export interface CreateFalkorDriverArgs {
  readonly fetcher: FalkorGraphFetcher;
  readonly now?: () => number;
}

export function createFalkorDriver(
  args: CreateFalkorDriverArgs,
): GraphDriverPort {
  if (!args.fetcher) {
    throw new GraphDatabaseError(
      'driver_unavailable',
      'createFalkorDriver requires a FalkorGraphFetcher',
    );
  }
  const now = args.now ?? (() => Date.now());

  return {
    id: 'falkordb',
    async run(query: CypherQuery): Promise<GraphResult> {
      assertTenantScopedQuery(query);
      const startedAt = now();
      let raw;
      try {
        raw = await args.fetcher.query(query.cypher, query.params);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new GraphDatabaseError(
          'driver_unavailable',
          `falkordb query failed: ${message}`,
          { cypher: query.cypher },
        );
      }
      const records: ReadonlyArray<GraphResultRecord> = raw.data.map((row) => ({
        fields: raw.header,
        values: row,
      }));
      const latencyMs = Math.max(0, now() - startedAt);
      return {
        driver: 'falkordb',
        tenantId: query.tenantId,
        records,
        latencyMs,
      };
    },
    async healthCheck() {
      const startedAt = now();
      try {
        if (args.fetcher.ping) {
          const pong = await args.fetcher.ping();
          return {
            ok: pong === 'PONG',
            latencyMs: Math.max(0, now() - startedAt),
            ...(pong !== 'PONG' ? { message: `unexpected ping reply: ${pong}` } : {}),
          };
        }
        return { ok: true, latencyMs: Math.max(0, now() - startedAt) };
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

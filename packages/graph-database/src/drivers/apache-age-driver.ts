/**
 * Apache AGE driver adapter for `@borjie/graph-database`.
 *
 * Apache AGE is a Postgres extension exposing openCypher over a
 * `cypher($$ ... $$)` SQL wrapper. We reach it through the
 * existing `pg` pool the host already maintains — no second
 * datastore.
 *
 * The host wires in a `PgQueryFetcher` port. The driver wraps the
 * Cypher into AGE's `SELECT * FROM cypher('graph_name', $$ ...
 * $$, params) AS (...)` envelope.
 *
 * @module @borjie/graph-database/drivers/apache-age-driver
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

export interface PgQueryFetcher {
  readonly query: (
    sql: string,
    values: ReadonlyArray<unknown>,
  ) => Promise<{
    readonly fields: ReadonlyArray<{ readonly name: string }>;
    readonly rows: ReadonlyArray<Record<string, unknown>>;
  }>;
  readonly end: () => Promise<void>;
}

export interface CreateApacheAgeDriverArgs {
  readonly fetcher: PgQueryFetcher;
  /** AGE graph name — defaults to `borjie_graph`. */
  readonly graphName?: string;
  readonly now?: () => number;
}

export function createApacheAgeDriver(
  args: CreateApacheAgeDriverArgs,
): GraphDriverPort {
  if (!args.fetcher) {
    throw new GraphDatabaseError(
      'driver_unavailable',
      'createApacheAgeDriver requires a PgQueryFetcher',
    );
  }
  const now = args.now ?? (() => Date.now());
  const graphName = args.graphName ?? 'borjie_graph';

  return {
    id: 'apache_age',
    async run(query: CypherQuery): Promise<GraphResult> {
      assertTenantScopedQuery(query);
      const startedAt = now();
      // AGE wraps Cypher into a SQL function. Params become positional.
      const { sql, values } = wrapCypherForAge(graphName, query);
      let raw;
      try {
        raw = await args.fetcher.query(sql, values);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new GraphDatabaseError(
          'driver_unavailable',
          `apache age query failed: ${message}`,
          { cypher: query.cypher },
        );
      }
      const fields = raw.fields.map((f) => f.name);
      const records: ReadonlyArray<GraphResultRecord> = raw.rows.map((row) => ({
        fields,
        values: fields.map((f) => row[f]),
      }));
      const latencyMs = Math.max(0, now() - startedAt);
      return {
        driver: 'apache_age',
        tenantId: query.tenantId,
        records,
        latencyMs,
      };
    },
    async healthCheck() {
      const startedAt = now();
      try {
        await args.fetcher.query('SELECT 1 AS ok', []);
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
      await args.fetcher.end();
    },
  };
}

// ---------------------------------------------------------------------------
// AGE envelope helpers
// ---------------------------------------------------------------------------

/**
 * AGE accepts a JSON-stringified params object as a positional
 * binding. Returns the SQL string + values array ready for `pg`.
 *
 * Note: AGE requires the cypher body to be quoted with `$$`. We
 * do not template-interp the cypher into the SQL — instead the
 * Cypher reference parameters by their `$name`s and AGE resolves
 * them from the JSON params object.
 */
export function wrapCypherForAge(
  graphName: string,
  query: CypherQuery,
): { readonly sql: string; readonly values: ReadonlyArray<unknown> } {
  // Default result column shape — caller can override via params.__columns__.
  const columnsSpec =
    typeof query.params['__columns__'] === 'string'
      ? (query.params['__columns__'] as string)
      : 'result agtype';
  const paramsJson = JSON.stringify(redactInternalKeys(query.params));
  const sql = [
    `SELECT * FROM cypher('${graphName}', $$`,
    query.cypher,
    `$$, $1::jsonb) AS (${columnsSpec})`,
  ].join('\n');
  return { sql, values: [paramsJson] };
}

function redactInternalKeys(
  params: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k.startsWith('__') && k.endsWith('__')) continue;
    result[k] = v;
  }
  return result;
}

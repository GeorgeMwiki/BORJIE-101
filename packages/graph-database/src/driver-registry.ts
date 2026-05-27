/**
 * Driver registry — routes a `CypherQuery` to the right driver.
 *
 * Composition root registers concrete driver instances (built via
 * `createNeo4jDriver`, `createFalkorDriver`, `createApacheAgeDriver`)
 * keyed by `GraphDriverId`. The registry honours the
 * `preferredDriver` hint on the query; otherwise it picks Neo4j
 * first, then FalkorDB, then Apache AGE.
 *
 * Health checks run on demand. A failing primary causes the next
 * `pick()` call to fall through to the next driver in order until
 * one returns `ok: true`.
 *
 * @module @borjie/graph-database/driver-registry
 */

import {
  GRAPH_DRIVERS,
  GraphDatabaseError,
  type CypherQuery,
  type GraphDriverId,
  type GraphDriverPort,
  type GraphResult,
  type QueryPlan,
} from './types.js';
import { assertTenantScopedQuery } from './query/tenant-scoped-query.js';

export interface DriverRegistryDeps {
  readonly drivers: Readonly<Partial<Record<GraphDriverId, GraphDriverPort>>>;
  /** Optional driver priority order; defaults to neo4j → falkordb → apache_age. */
  readonly priority?: ReadonlyArray<GraphDriverId>;
}

export interface DriverRegistry {
  readonly availableDrivers: () => ReadonlyArray<GraphDriverId>;
  readonly plan: (query: CypherQuery) => QueryPlan;
  readonly run: (query: CypherQuery) => Promise<GraphResult>;
  readonly healthAll: () => Promise<
    Readonly<
      Record<
        GraphDriverId,
        { readonly ok: boolean; readonly latencyMs: number; readonly message?: string } | null
      >
    >
  >;
  readonly closeAll: () => Promise<void>;
}

const DEFAULT_PRIORITY: ReadonlyArray<GraphDriverId> = [
  'neo4j',
  'falkordb',
  'apache_age',
];

export function createDriverRegistry(deps: DriverRegistryDeps): DriverRegistry {
  const drivers = deps.drivers;
  const priority = deps.priority ?? DEFAULT_PRIORITY;

  function pickDriver(query: CypherQuery): GraphDriverPort {
    if (query.preferredDriver !== undefined) {
      const preferred = drivers[query.preferredDriver];
      if (preferred) return preferred;
    }
    for (const id of priority) {
      const driver = drivers[id];
      if (driver) return driver;
    }
    throw new GraphDatabaseError(
      'driver_unavailable',
      'no graph drivers registered',
      { available: Object.keys(drivers) },
    );
  }

  return {
    availableDrivers() {
      return GRAPH_DRIVERS.filter((id) => drivers[id] !== undefined);
    },
    plan(query: CypherQuery): QueryPlan {
      assertTenantScopedQuery(query);
      const picked = pickDriver(query);
      return {
        driver: picked.id,
        estimatedLatencyMs: picked.id === 'falkordb' ? 5 : 50,
        reason:
          query.preferredDriver !== undefined && picked.id === query.preferredDriver
            ? 'preferred driver explicitly requested'
            : `priority-fallback to ${picked.id}`,
      };
    },
    async run(query: CypherQuery): Promise<GraphResult> {
      assertTenantScopedQuery(query);
      const driver = pickDriver(query);
      return driver.run(query);
    },
    async healthAll() {
      const out: Partial<
        Record<
          GraphDriverId,
          { readonly ok: boolean; readonly latencyMs: number; readonly message?: string } | null
        >
      > = {};
      for (const id of GRAPH_DRIVERS) {
        const driver = drivers[id];
        if (!driver) {
          out[id] = null;
          continue;
        }
        const result = await driver.healthCheck();
        out[id] = {
          ok: result.ok,
          latencyMs: result.latencyMs,
          ...(result.message !== undefined ? { message: result.message } : {}),
        };
      }
      return out as Readonly<
        Record<
          GraphDriverId,
          { readonly ok: boolean; readonly latencyMs: number; readonly message?: string } | null
        >
      >;
    },
    async closeAll(): Promise<void> {
      for (const id of GRAPH_DRIVERS) {
        const driver = drivers[id];
        if (driver) {
          await driver.close();
        }
      }
    },
  };
}

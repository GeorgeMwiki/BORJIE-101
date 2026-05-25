/**
 * DSAR collector contract — the port through which the pipeline reads
 * subject data from concrete data sources.
 *
 * Consumers wire one or more collectors at startup (Drizzle / Postgres /
 * Mongo / Snowflake / etc.) and the DSAR service walks all registered
 * collectors when a request arrives.
 *
 * Collectors are PURE functions over a typed query — we do not allow
 * raw SQL at this layer; concrete adapters are responsible for safe
 * query construction in their own integration package.
 */

import type { DSARRecord } from '../types.js';

/**
 * One collector — one logical data source. Implementations can wrap a
 * single Postgres table, a JSON file, a Drizzle query builder, or a
 * REST endpoint. The contract is: given a subject id, return every
 * row that belongs to that subject.
 */
export interface DSARCollector {
  readonly id: string;
  readonly displayName: string;
  collect(subjectId: string): Promise<ReadonlyArray<DSARRecord>>;
}

/**
 * Static fixture collector — used by tests + as a reference impl.
 * The fixture is a deterministic in-memory map.
 */
export function createFixtureCollector(params: {
  readonly id: string;
  readonly displayName?: string;
  readonly fixture: ReadonlyMap<string, ReadonlyArray<DSARRecord>>;
}): DSARCollector {
  return {
    id: params.id,
    displayName: params.displayName ?? params.id,
    collect: async (subjectId) => {
      const rows = params.fixture.get(subjectId);
      return rows ?? [];
    },
  };
}

/**
 * Run every collector in parallel and concatenate the result.
 *
 * Errors per-collector are propagated rather than swallowed — a DSAR
 * that fails partway through must be re-runnable; partial responses
 * to the data subject are a compliance failure.
 */
export async function runCollectors(
  collectors: ReadonlyArray<DSARCollector>,
  subjectId: string,
): Promise<ReadonlyArray<DSARRecord>> {
  const batches = await Promise.all(collectors.map((c) => c.collect(subjectId)));
  return batches.flat();
}

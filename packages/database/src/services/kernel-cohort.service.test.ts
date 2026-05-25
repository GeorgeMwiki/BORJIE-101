/**
 * Unit tests for createPgTenantAggregateSource.
 *
 * The intent here is shape-correctness, not query semantics: we hand
 * the factory a DatabaseClient whose select/from/where chain returns
 * empty arrays, then assert that every statistic in the catalogue
 * resolves without throwing. Drizzle's full type-checking is exercised
 * elsewhere in `pnpm -C packages/database typecheck`.
 */

import { describe, it, expect } from 'vitest';
import {
  createPgTenantAggregateSource,
  type PlatformSliceShape,
} from './kernel-cohort.service.js';
import type { DatabaseClient } from '../client.js';

// ─────────────────────────────────────────────────────────────────────
// Stub DatabaseClient — every chain terminates in an empty result.
// We cannot mock the full Drizzle generic surface, but since the
// service swallows per-tenant errors and the aggregator handles empty
// contributions, returning [] from any awaited chain is sufficient.
// ─────────────────────────────────────────────────────────────────────

function makeStubDb(): DatabaseClient {
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  // Drizzle's query builder returns thenables on `await`, so the
  // chain itself must be promise-compatible.
  Object.assign(chain, {
    select: passthrough,
    from: passthrough,
    where: passthrough,
    leftJoin: passthrough,
    innerJoin: passthrough,
    groupBy: passthrough,
    orderBy: passthrough,
    limit: passthrough,
    then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
    catch: () => chain,
    finally: () => chain,
  });
  return chain as unknown as DatabaseClient;
}

const SLICE: PlatformSliceShape = Object.freeze({
  jurisdictions: ['TZ'],
  propertyClasses: [],
  from: '2026-01-01T00:00:00.000Z',
  to: '2026-04-01T00:00:00.000Z',
});

describe('createPgTenantAggregateSource', () => {
  it('eligibleTenants resolves without throwing', async () => {
    const source = createPgTenantAggregateSource(makeStubDb());
    const tenants = await source.eligibleTenants(SLICE);
    expect(Array.isArray(tenants)).toBe(true);
  });

  const STATS: ReadonlyArray<string> = [
    'arrears_rate',
    'collection_rate',
    'vacancy_days_mean',
    'renewal_rate',
    'maintenance_ttc_mean',
  ];

  for (const statistic of STATS) {
    it(`contributionsFor(${statistic}) resolves without throwing`, async () => {
      const source = createPgTenantAggregateSource(makeStubDb());
      const result = await source.contributionsFor({
        tenantId: 't_test',
        statistic,
        slice: SLICE,
      });
      expect(Array.isArray(result)).toBe(true);
    });
  }

  it('unknown statistics return empty contributions', async () => {
    const source = createPgTenantAggregateSource(makeStubDb());
    const result = await source.contributionsFor({
      tenantId: 't_test',
      statistic: 'definitely_not_a_real_stat',
      slice: SLICE,
    });
    expect(result).toEqual([]);
  });
});

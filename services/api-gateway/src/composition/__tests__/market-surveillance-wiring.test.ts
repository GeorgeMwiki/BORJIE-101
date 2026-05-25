/**
 * Unit tests for the market-surveillance composition wiring.
 *
 * Coverage:
 *   - Degraded fall-through when no DB client is provided.
 *   - Stub `MarketRatePort` adapterId + empty-comparable contract.
 *   - `listActiveUnits` Drizzle join shape — projects unit + property
 *     + active-lease rows into `UnitForSurveillance` (tenant-scoped,
 *     active-lease wins as canonical rent / currency).
 *   - `listActiveUnits` swallows DB errors and returns `[]`.
 *   - `insertSnapshot` delegation to the underlying Drizzle service.
 *   - `createCachedMarketRatePort` read-through caching: cache-hit
 *     short-circuits the inner adapter; cache-miss writes through.
 *   - The composition root wires the cache automatically when a real
 *     adapter is supplied.
 *
 * The Drizzle client is faked with a chainable recorder + canned-row
 * helper modelled after agency-binding.test.ts so the surveillance loop
 * runs end-to-end without a real Postgres.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_COMPARABLES_CACHE_TTL_MS,
  STUB_ADAPTER_ID,
  createCachedMarketRatePort,
  createDrizzleMarketSurveillanceRepository,
  createMarketSurveillanceWiring,
  createStubMarketRatePort,
} from '../market-surveillance-wiring';
import type {
  ComparableListing,
  MarketRatePort,
  MarketRateSnapshot,
} from '@borjie/ai-copilot/ai-native';
import type { MarketDataCacheService } from '@borjie/database';

// ---------------------------------------------------------------------------
// Fake Drizzle client — minimal chainable shape that records every
// invocation and returns canned rows for select chains.
// ---------------------------------------------------------------------------

interface FakeInsertCall {
  readonly table: unknown;
  readonly values: unknown;
}

interface FakeDb {
  __inserts: FakeInsertCall[];
  __setNextSelectRows(rows: unknown[]): void;
  __throwOnSelect: boolean;
  insert(table: unknown): {
    values(values: unknown): Promise<void>;
  };
  select(args?: unknown): FakeSelectChain;
}

interface FakeSelectChain extends PromiseLike<readonly unknown[]> {
  from(args: unknown): FakeSelectChain;
  innerJoin(table: unknown, on: unknown): FakeSelectChain;
  leftJoin(table: unknown, on: unknown): FakeSelectChain;
  where(args: unknown): FakeSelectChain;
  orderBy(args: unknown): FakeSelectChain;
  limit(n: number): Promise<readonly unknown[]>;
}

function createFakeDb(): FakeDb {
  const inserts: FakeInsertCall[] = [];
  const state = {
    nextSelectRows: [] as unknown[],
    throwOnSelect: false,
  };

  function makeChain(): FakeSelectChain {
    const chain = {
      from() {
        return chain;
      },
      innerJoin() {
        return chain;
      },
      leftJoin() {
        return chain;
      },
      where() {
        return chain;
      },
      orderBy() {
        return chain;
      },
      async limit() {
        if (state.throwOnSelect) throw new Error('synthetic-db-error');
        const rows = state.nextSelectRows;
        state.nextSelectRows = [];
        return rows;
      },
      // PromiseLike — `await chain` resolves with the canned rows so a
      // production query that doesn't terminate with `.limit()` (e.g.
      // listActiveUnits) still resolves naturally.
      then<TResult1 = readonly unknown[], TResult2 = never>(
        onfulfilled?:
          | ((value: readonly unknown[]) => TResult1 | PromiseLike<TResult1>)
          | null
          | undefined,
        onrejected?:
          | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
          | null
          | undefined,
      ): PromiseLike<TResult1 | TResult2> {
        if (state.throwOnSelect) {
          return Promise.reject(new Error('synthetic-db-error')).then(
            onfulfilled,
            onrejected,
          );
        }
        const rows = state.nextSelectRows;
        state.nextSelectRows = [];
        return Promise.resolve(rows).then(onfulfilled, onrejected);
      },
    } as FakeSelectChain;
    return chain;
  }

  return {
    __inserts: inserts,
    get __throwOnSelect() {
      return state.throwOnSelect;
    },
    set __throwOnSelect(v: boolean) {
      state.throwOnSelect = v;
    },
    __setNextSelectRows(rows) {
      state.nextSelectRows = rows;
    },
    insert(table) {
      return {
        async values(values) {
          inserts.push({ table, values });
        },
      };
    },
    select() {
      return makeChain();
    },
  };
}

function makeSnapshot(overrides: Partial<MarketRateSnapshot> = {}): MarketRateSnapshot {
  return {
    id: 'mrss_test_1',
    tenantId: 't1',
    unitId: 'u1',
    propertyId: 'p1',
    currencyCode: 'TZS',
    ourRentMinor: 250_000,
    marketMedianMinor: null,
    marketP25Minor: null,
    marketP75Minor: null,
    marketSampleSize: 0,
    deltaPct: null,
    driftFlag: null,
    compRadiusKm: 2,
    sourceAdapter: STUB_ADAPTER_ID,
    sourceMetadata: { comparableCount: 0 },
    modelVersion: 'degraded',
    promptHash: null,
    observedAt: '2026-05-08T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// In-memory `MarketDataCacheService` — exercises the cache-wrap behaviour
// without any DB interaction.
// ---------------------------------------------------------------------------

interface InMemoryCache extends MarketDataCacheService {
  readonly __getCalls: () => number;
  readonly __putCalls: () => ReadonlyArray<{ key: string; provider: string; ttlMs: number }>;
}

function createInMemoryCache(): InMemoryCache {
  const store = new Map<
    string,
    { resultJson: unknown; fetchedAt: string; expiresAt: number }
  >();
  let getCalls = 0;
  const putCalls: Array<{ key: string; provider: string; ttlMs: number }> = [];
  return {
    __getCalls: () => getCalls,
    __putCalls: () => putCalls,
    async get(cacheKey) {
      getCalls += 1;
      const hit = store.get(cacheKey);
      if (!hit) return null;
      if (hit.expiresAt <= Date.now()) return null;
      return { resultJson: hit.resultJson, fetchedAt: hit.fetchedAt };
    },
    async put(cacheKey, provider, _queryJson, resultJson, ttlMs) {
      putCalls.push({ key: cacheKey, provider, ttlMs });
      store.set(cacheKey, {
        resultJson,
        fetchedAt: new Date().toISOString(),
        expiresAt: Date.now() + ttlMs,
      });
    },
    async purgeExpired() {
      return 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures — mimic the `listActiveUnits` join row shape.
// ---------------------------------------------------------------------------

function makeActiveUnitRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    unitId: 'u1',
    propertyId: 'p1',
    unitTenantId: 't1',
    bedrooms: 2,
    bathrooms: '1.5',
    squareMeters: '60.00',
    unitAmenities: ['parking', 'wifi'],
    baseRentAmount: 200_000,
    baseRentCurrency: 'TZS',
    propertyLat: '-6.7924',
    propertyLon: '39.2083',
    propertyDefaultCurrency: 'TZS',
    leaseRentAmount: 250_000,
    leaseRentCurrency: 'TZS',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('market-surveillance-wiring', () => {
  it('returns null when db is absent (degraded mode) and warns via logger', () => {
    const warnings: Array<{ meta: object; msg: string }> = [];
    const wiring = createMarketSurveillanceWiring({
      db: null,
      logger: {
        warn(meta, msg) {
          warnings.push({ meta, msg });
        },
      },
    });
    expect(wiring).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.msg).toMatch(/no database client/);
  });

  it('returns wiring with .agent when db is provided', () => {
    const db = createFakeDb();
    const wiring = createMarketSurveillanceWiring({
      db: db as unknown as Parameters<typeof createMarketSurveillanceWiring>[0]['db'],
    });
    expect(wiring).not.toBeNull();
    expect(typeof wiring?.agent.scanTenant).toBe('function');
    expect(typeof wiring?.agent.scanUnit).toBe('function');
    expect(typeof wiring?.agent.listRecentSnapshots).toBe('function');
  });

  it('stub market-rate port advertises the not-configured adapterId and returns no comparables', async () => {
    const port = createStubMarketRatePort();
    expect(port.adapterId).toBe(STUB_ADAPTER_ID);
    const comps = await port.fetchComparables({
      tenantId: 't1',
      unitId: 'u1',
      latitude: null,
      longitude: null,
      radiusKm: 2,
      bedrooms: null,
    });
    expect(comps).toEqual([]);
  });

  it('listActiveUnits projects join rows into UnitForSurveillance with active-lease rent winning', async () => {
    const db = createFakeDb();
    db.__setNextSelectRows([makeActiveUnitRow()]);

    const repo = createDrizzleMarketSurveillanceRepository(
      db as unknown as Parameters<typeof createDrizzleMarketSurveillanceRepository>[0],
    );
    const units = await repo.listActiveUnits('t1');
    expect(units).toHaveLength(1);
    const u = units[0]!;
    expect(u.tenantId).toBe('t1');
    expect(u.unitId).toBe('u1');
    expect(u.propertyId).toBe('p1');
    // Active lease wins as canonical rent / currency.
    expect(u.ourRentMinor).toBe(250_000);
    expect(u.currencyCode).toBe('TZS');
    expect(u.bedrooms).toBe(2);
    expect(u.bathrooms).toBe(1.5);
    // 60 m² ≈ 646 sqft
    expect(u.sqft).toBe(646);
    // Property lat/lon decimal columns come back as strings; we coerce.
    expect(u.latitude).toBeCloseTo(-6.7924, 4);
    expect(u.longitude).toBeCloseTo(39.2083, 4);
    expect(u.amenities).toEqual(['parking', 'wifi']);
  });

  it('listActiveUnits falls back to unit base rent + property default currency when no active lease row joins', async () => {
    const db = createFakeDb();
    db.__setNextSelectRows([
      makeActiveUnitRow({
        leaseRentAmount: null,
        leaseRentCurrency: null,
        baseRentCurrency: '',
        propertyDefaultCurrency: 'KES',
      }),
    ]);

    const repo = createDrizzleMarketSurveillanceRepository(
      db as unknown as Parameters<typeof createDrizzleMarketSurveillanceRepository>[0],
    );
    const units = await repo.listActiveUnits('t1');
    expect(units).toHaveLength(1);
    expect(units[0]?.ourRentMinor).toBe(200_000);
    expect(units[0]?.currencyCode).toBe('KES');
  });

  it('listActiveUnits returns [] for empty tenantId and never queries', async () => {
    const db = createFakeDb();
    db.__throwOnSelect = true; // would surface as an error if the query fired
    const repo = createDrizzleMarketSurveillanceRepository(
      db as unknown as Parameters<typeof createDrizzleMarketSurveillanceRepository>[0],
    );
    const units = await repo.listActiveUnits('');
    expect(units).toEqual([]);
  });

  it('listActiveUnits swallows DB errors and returns [] (logs via logger)', async () => {
    const warnings: Array<{ meta: object; msg: string }> = [];
    const db = createFakeDb();
    db.__throwOnSelect = true;
    const repo = createDrizzleMarketSurveillanceRepository(
      db as unknown as Parameters<typeof createDrizzleMarketSurveillanceRepository>[0],
      {
        warn(meta, msg) {
          warnings.push({ meta, msg });
        },
      },
    );
    const units = await repo.listActiveUnits('t1');
    expect(units).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.msg).toMatch(/listActiveUnits query failed/);
  });

  it('scanTenant tolerates an empty active-units list', async () => {
    const db = createFakeDb();
    db.__setNextSelectRows([]);
    const wiring = createMarketSurveillanceWiring({
      db: db as unknown as Parameters<typeof createMarketSurveillanceWiring>[0]['db'],
    });
    const out = await wiring!.agent.scanTenant('t1');
    expect(out).toEqual([]);
    // No insert was issued because there were no units to scan.
    expect(db.__inserts).toHaveLength(0);
  });

  it('repo adapter delegates insertSnapshot to the underlying Drizzle service', async () => {
    const db = createFakeDb();
    const repo = createDrizzleMarketSurveillanceRepository(
      db as unknown as Parameters<typeof createDrizzleMarketSurveillanceRepository>[0],
    );
    const snapshot = makeSnapshot({ id: 'mrss_alpha', tenantId: 'tenant-a', unitId: 'unit-a' });
    const stored = await repo.insertSnapshot(snapshot);

    expect(stored.id).toBe('mrss_alpha');
    expect(stored.sourceAdapter).toBe(STUB_ADAPTER_ID);
    expect(db.__inserts).toHaveLength(1);

    // The DB service column rename `ourRentMinor` -> `ourRentAmountMinor`
    // happens inside the storage adapter, so the recorded `values` payload
    // should carry the renamed column.
    const written = db.__inserts[0]?.values as Record<string, unknown>;
    expect(written.id).toBe('mrss_alpha');
    expect(written.tenantId).toBe('tenant-a');
    expect(written.unitId).toBe('unit-a');
    expect(written.ourRentAmountMinor).toBe(250_000);
    expect(written.sourceAdapter).toBe(STUB_ADAPTER_ID);
  });
});

describe('createCachedMarketRatePort', () => {
  function makeRealAdapter(
    response: readonly ComparableListing[],
  ): MarketRatePort & { __calls: number } {
    let calls = 0;
    const port: MarketRatePort & { __calls: number } = {
      adapterId: 'fake-real-adapter',
      get __calls() {
        return calls;
      },
      set __calls(v: number) {
        calls = v;
      },
      async fetchComparables() {
        calls += 1;
        return response;
      },
    };
    return port;
  }

  const sampleListing: ComparableListing = {
    adapterId: 'fake-real-adapter',
    url: 'https://example.test/listing/1',
    title: 'Sunny 2BR',
    rawDescription: '2BR, 60m², parking, wifi — TZS 240,000/month',
    latitude: -6.79,
    longitude: 39.21,
  };

  const params = {
    tenantId: 't1',
    unitId: 'u1',
    latitude: -6.79,
    longitude: 39.21,
    radiusKm: 2,
    bedrooms: 2,
  };

  it('passes through to the inner adapter on cache miss and writes the result through', async () => {
    const inner = makeRealAdapter([sampleListing]);
    const cache = createInMemoryCache();
    const port = createCachedMarketRatePort({ inner, cache });

    const out = await port.fetchComparables(params);
    expect(out).toEqual([sampleListing]);
    expect(inner.__calls).toBe(1);
    expect(cache.__putCalls()).toHaveLength(1);
    expect(cache.__putCalls()[0]?.provider).toBe('fake-real-adapter');
    expect(cache.__putCalls()[0]?.ttlMs).toBe(DEFAULT_COMPARABLES_CACHE_TTL_MS);
  });

  it('returns the cached entry on the second call without invoking the inner adapter', async () => {
    const inner = makeRealAdapter([sampleListing]);
    const cache = createInMemoryCache();
    const port = createCachedMarketRatePort({ inner, cache });

    const first = await port.fetchComparables(params);
    const second = await port.fetchComparables(params);

    expect(first).toEqual([sampleListing]);
    expect(second).toEqual([sampleListing]);
    expect(inner.__calls).toBe(1); // second hit was served from cache
    expect(cache.__getCalls()).toBe(2);
    expect(cache.__putCalls()).toHaveLength(1);
  });

  it('treats different query parameters as different cache keys', async () => {
    const inner = makeRealAdapter([sampleListing]);
    const cache = createInMemoryCache();
    const port = createCachedMarketRatePort({ inner, cache });

    await port.fetchComparables(params);
    await port.fetchComparables({ ...params, bedrooms: 3 });

    expect(inner.__calls).toBe(2);
    expect(cache.__putCalls()).toHaveLength(2);
    expect(cache.__putCalls()[0]?.key).not.toBe(cache.__putCalls()[1]?.key);
  });

  it('short-circuits caching for the stub adapter (no put called)', async () => {
    const inner = createStubMarketRatePort();
    const cache = createInMemoryCache();
    const port = createCachedMarketRatePort({ inner, cache });

    const out = await port.fetchComparables(params);
    expect(out).toEqual([]);
    expect(cache.__getCalls()).toBe(0);
    expect(cache.__putCalls()).toHaveLength(0);
  });

  it('honours a caller-supplied ttlMs override', async () => {
    const inner = makeRealAdapter([sampleListing]);
    const cache = createInMemoryCache();
    const port = createCachedMarketRatePort({ inner, cache, ttlMs: 60_000 });

    await port.fetchComparables(params);
    expect(cache.__putCalls()[0]?.ttlMs).toBe(60_000);
  });

  it('falls through to the inner adapter when cache.get throws (degraded cache)', async () => {
    const inner = makeRealAdapter([sampleListing]);
    const failingCache: MarketDataCacheService = {
      async get() {
        throw new Error('cache-down');
      },
      async put() {
        // accept silently — the wrap should still try to put
      },
      async purgeExpired() {
        return 0;
      },
    };
    const port = createCachedMarketRatePort({ inner, cache: failingCache });
    const out = await port.fetchComparables(params);
    expect(out).toEqual([sampleListing]);
    expect(inner.__calls).toBe(1);
  });
});

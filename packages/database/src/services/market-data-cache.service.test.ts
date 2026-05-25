/**
 * Unit tests for createMarketDataCacheService.
 *
 * The Drizzle DatabaseClient is stubbed with a tiny in-memory table
 * that mirrors only the call shape this service uses:
 *   - select().from().where().limit() returning a row array
 *   - insert().values().onConflictDoUpdate()
 *   - delete().where()
 *
 * Tests cover the contract in market-data-cache.service.ts:
 *   1. get returns null when missing
 *   2. put + get round-trips with the cached payload
 *   3. expired entries return null (cache miss → caller re-fetches)
 *   4. purgeExpired returns the count purged
 *   5. put with non-positive ttlMs throws RangeError
 *   6. get with empty cacheKey returns null
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMarketDataCacheService } from './market-data-cache.service.js';
import type { DatabaseClient } from '../client.js';

// ─────────────────────────────────────────────────────────────────────
// In-memory stub backing store.
// ─────────────────────────────────────────────────────────────────────

interface StoredRow {
  cacheKey: string;
  provider: string;
  queryJson: unknown;
  resultJson: unknown;
  fetchedAt: Date;
  expiresAt: Date;
}

interface StubDb {
  client: DatabaseClient;
  rows: StoredRow[];
}

function makeStubDb(initialRows: ReadonlyArray<StoredRow> = []): StubDb {
  const state: StubDb = {
    client: null as unknown as DatabaseClient,
    rows: [...initialRows],
  };

  function makeSelectChain(): unknown {
    const chain: Record<string, unknown> = {
      _filter: null as ((row: StoredRow) => boolean) | null,
      from: () => chain,
      where: (predicate: unknown) => {
        const captured = capturedEqValues.shift();
        chain._filter = captured
          ? (r: StoredRow) => r.cacheKey === captured.cacheKey
          : () => true;
        void predicate;
        return chain;
      },
      limit: (_n: number) => chain,
      then: (resolve: (rows: unknown) => unknown) => {
        const filt = chain._filter as ((row: StoredRow) => boolean) | null;
        const filtered = filt ? state.rows.filter(filt) : [...state.rows];
        return resolve(filtered);
      },
    };
    return chain;
  }

  function makeInsertChain(): unknown {
    const chain: Record<string, unknown> = {
      _values: null as Partial<StoredRow> | null,
      values: (v: Partial<StoredRow>) => {
        chain._values = v;
        return chain;
      },
      onConflictDoUpdate: (cfg: { set: Partial<StoredRow> }) => {
        const v = (chain._values ?? {}) as Partial<StoredRow>;
        const cacheKey = String(v.cacheKey ?? '');
        const existing = state.rows.find((r) => r.cacheKey === cacheKey);
        if (existing) {
          Object.assign(existing, cfg.set);
        } else {
          state.rows.push({
            cacheKey,
            provider: String(v.provider ?? ''),
            queryJson: v.queryJson,
            resultJson: v.resultJson,
            fetchedAt: v.fetchedAt instanceof Date ? v.fetchedAt : new Date(),
            expiresAt: v.expiresAt instanceof Date ? v.expiresAt : new Date(),
          });
        }
        return chain;
      },
      then: (resolve: (rows: unknown) => unknown) => {
        // If onConflictDoUpdate hasn't been called yet (single .values()
        // .then() chain), fall through to a plain insert.
        const v = (chain._values ?? null) as Partial<StoredRow> | null;
        if (v && !state.rows.some((r) => r.cacheKey === v.cacheKey)) {
          state.rows.push({
            cacheKey: String(v.cacheKey ?? ''),
            provider: String(v.provider ?? ''),
            queryJson: v.queryJson,
            resultJson: v.resultJson,
            fetchedAt: v.fetchedAt instanceof Date ? v.fetchedAt : new Date(),
            expiresAt: v.expiresAt instanceof Date ? v.expiresAt : new Date(),
          });
        }
        return resolve(undefined);
      },
    };
    return chain;
  }

  function makeDeleteChain(): unknown {
    const chain: Record<string, unknown> = {
      where: (predicate: unknown) => {
        // Predicate is `expiresAt <= NOW()`. We capture the column op
        // via the lte mock and apply it here.
        const captured = capturedLteSql.shift();
        const before = state.rows.length;
        if (captured?.kind === 'expires-now') {
          state.rows = state.rows.filter(
            (r) => r.expiresAt.getTime() > Date.now(),
          );
        }
        const removed = before - state.rows.length;
        chain._removed = removed;
        void predicate;
        return chain;
      },
      then: (resolve: (rows: unknown) => unknown) => {
        return resolve({ rowCount: chain._removed ?? 0 });
      },
      _removed: 0,
    };
    return chain;
  }

  const db: Record<string, unknown> = {
    select: () => makeSelectChain(),
    insert: () => makeInsertChain(),
    delete: () => makeDeleteChain(),
  };
  state.client = db as unknown as DatabaseClient;
  return state;
}

// ─────────────────────────────────────────────────────────────────────
// drizzle-orm operator mocks — capture the column → value pair so the
// stub chain can filter the in-memory rows.
// ─────────────────────────────────────────────────────────────────────

const capturedEqValues: Array<{ cacheKey?: string }> = [];
const capturedLteSql: Array<{ kind: 'expires-now' | 'unknown' }> = [];

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (column: { name?: string }, value: unknown) => {
      const colName = String(column?.name ?? '');
      if (colName === 'cache_key') {
        capturedEqValues.push({ cacheKey: String(value) });
      }
      return { _op: 'eq', col: colName, value };
    },
    lte: (column: { name?: string }, _value: unknown) => {
      const colName = String(column?.name ?? '');
      if (colName === 'expires_at') {
        capturedLteSql.push({ kind: 'expires-now' });
      } else {
        capturedLteSql.push({ kind: 'unknown' });
      }
      return { _op: 'lte', col: colName };
    },
    sql: Object.assign(
      (strings: TemplateStringsArray) => ({ _sql: strings.join('') }),
      { raw: (s: string) => ({ _sql: s }) },
    ),
  };
});

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('createMarketDataCacheService', () => {
  beforeEach(() => {
    capturedEqValues.length = 0;
    capturedLteSql.length = 0;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('get returns null when no row exists', async () => {
    const stub = makeStubDb([]);
    const svc = createMarketDataCacheService(stub.client);

    const out = await svc.get('missing-key');

    expect(out).toBeNull();
  });

  it('get returns null when cacheKey is empty', async () => {
    const stub = makeStubDb([]);
    const svc = createMarketDataCacheService(stub.client);

    const out = await svc.get('');

    expect(out).toBeNull();
  });

  it('put + get round-trips the cached payload', async () => {
    const stub = makeStubDb([]);
    const svc = createMarketDataCacheService(stub.client);

    await svc.put(
      'k1',
      'zillow',
      { jurisdiction: 'TZ-DAR', bedrooms: 2 },
      { rents: [{ rentMajor: 1200, currency: 'USD' }] },
      60_000,
    );

    const out = await svc.get('k1');

    expect(out).not.toBeNull();
    expect(out?.resultJson).toEqual({
      rents: [{ rentMajor: 1200, currency: 'USD' }],
    });
    expect(typeof out?.fetchedAt).toBe('string');
    // The row should have an expires_at strictly in the future.
    expect(stub.rows[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('get returns null when the entry has expired (cache miss)', async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const stub = makeStubDb([
      {
        cacheKey: 'expired-key',
        provider: 'zillow',
        queryJson: { jurisdiction: 'TZ-DAR' },
        resultJson: { rents: [] },
        fetchedAt: tenMinutesAgo,
        expiresAt: fiveMinutesAgo,
      },
    ]);
    const svc = createMarketDataCacheService(stub.client);

    const out = await svc.get('expired-key');

    expect(out).toBeNull();
  });

  it('get returns the cached payload when expires_at is in the future', async () => {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const oneMinuteAhead = new Date(Date.now() + 60 * 1000);
    const stub = makeStubDb([
      {
        cacheKey: 'fresh-key',
        provider: 'airbnb',
        queryJson: { jurisdiction: 'KE-NAIROBI' },
        resultJson: { sample: 42 },
        fetchedAt: oneMinuteAgo,
        expiresAt: oneMinuteAhead,
      },
    ]);
    const svc = createMarketDataCacheService(stub.client);

    const out = await svc.get('fresh-key');

    expect(out?.resultJson).toEqual({ sample: 42 });
  });

  it('purgeExpired removes only expired rows and returns the count', async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const oneMinuteAhead = new Date(Date.now() + 60 * 1000);
    const stub = makeStubDb([
      {
        cacheKey: 'gone-1',
        provider: 'zillow',
        queryJson: {},
        resultJson: {},
        fetchedAt: tenMinutesAgo,
        expiresAt: fiveMinutesAgo,
      },
      {
        cacheKey: 'gone-2',
        provider: 'airbnb',
        queryJson: {},
        resultJson: {},
        fetchedAt: tenMinutesAgo,
        expiresAt: fiveMinutesAgo,
      },
      {
        cacheKey: 'kept',
        provider: 'zillow',
        queryJson: {},
        resultJson: {},
        fetchedAt: tenMinutesAgo,
        expiresAt: oneMinuteAhead,
      },
    ]);
    const svc = createMarketDataCacheService(stub.client);

    const purged = await svc.purgeExpired();

    expect(purged).toBe(2);
    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0]?.cacheKey).toBe('kept');
  });

  it('put rejects ttlMs of zero or negative with RangeError', async () => {
    const stub = makeStubDb([]);
    const svc = createMarketDataCacheService(stub.client);

    await expect(svc.put('k', 'zillow', {}, {}, 0)).rejects.toBeInstanceOf(
      RangeError,
    );
    await expect(svc.put('k', 'zillow', {}, {}, -1)).rejects.toBeInstanceOf(
      RangeError,
    );
  });

  it('put rejects when cacheKey or provider is empty', async () => {
    const stub = makeStubDb([]);
    const svc = createMarketDataCacheService(stub.client);

    await expect(svc.put('', 'zillow', {}, {}, 1000)).rejects.toThrow(
      /cacheKey/,
    );
    await expect(svc.put('k', '', {}, {}, 1000)).rejects.toThrow(/provider/);
  });
});

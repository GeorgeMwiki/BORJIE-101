/**
 * IdempotencyStore tests — KI-012 closure.
 *
 * Covers:
 *   1. InMemoryIdempotencyStore — first sight returns false, second returns true
 *   2. RedisIdempotencyStore    — uses SET NX EX semantics correctly
 *   3. RedisIdempotencyStore    — falls back to in-memory on Redis failure
 *   4. CallbackDeduplicator     — legacy sync API still works
 *   5. createIdempotencyStore   — returns in-memory when REDIS_URL absent
 */

import { describe, it, expect } from 'vitest';
import {
  CallbackDeduplicator,
  InMemoryIdempotencyStore,
  RedisIdempotencyStore,
  createIdempotencyStore,
  type RedisLikeClient,
} from '../middleware/mpesa-webhook.middleware.js';

describe('InMemoryIdempotencyStore', () => {
  it('returns false on first sight, true on second', async () => {
    const store = new InMemoryIdempotencyStore();
    expect(await store.seenBefore('k1')).toBe(false);
    expect(await store.seenBefore('k1')).toBe(true);
    expect(await store.seenBefore('k2')).toBe(false);
  });

  it('sync API mirrors the async API', () => {
    const store = new InMemoryIdempotencyStore();
    expect(store.seenBeforeSync('x')).toBe(false);
    expect(store.seenBeforeSync('x')).toBe(true);
  });
});

describe('RedisIdempotencyStore', () => {
  it('returns false when SET NX returns "OK" (first sight)', async () => {
    const calls: Array<[string, string, string, number, string]> = [];
    const client: RedisLikeClient = {
      async set(key, value, mode, ttl, setNx) {
        calls.push([key, value, mode, ttl, setNx]);
        return 'OK';
      },
    };
    const store = new RedisIdempotencyStore({ client });
    expect(await store.seenBefore('abc')).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(['mpesa:idem:abc', '1', 'EX', 86_400, 'NX']);
  });

  it('returns true when SET NX returns null (duplicate)', async () => {
    const client: RedisLikeClient = {
      async set() {
        return null;
      },
    };
    const store = new RedisIdempotencyStore({ client });
    expect(await store.seenBefore('dup-key')).toBe(true);
  });

  it('honours custom prefix and ttl', async () => {
    const calls: Array<[string, number]> = [];
    const client: RedisLikeClient = {
      async set(key, _value, _mode, ttl) {
        calls.push([key, ttl]);
        return 'OK';
      },
    };
    const store = new RedisIdempotencyStore({
      client,
      keyPrefix: 'custom:',
      ttlSeconds: 60,
    });
    await store.seenBefore('x');
    expect(calls[0]).toEqual(['custom:x', 60]);
  });

  it('falls back to in-memory store when Redis throws', async () => {
    const warnings: Array<[unknown, string]> = [];
    const client: RedisLikeClient = {
      async set() {
        throw new Error('ECONNREFUSED');
      },
    };
    const fallback = new InMemoryIdempotencyStore();
    const store = new RedisIdempotencyStore({
      client,
      fallback,
      logger: {
        warn: (ctx, msg) => {
          warnings.push([ctx, msg]);
        },
      },
    });

    // First sight via the fallback path.
    expect(await store.seenBefore('outage-k')).toBe(false);
    // Second sight: the redis call still throws but the fallback sees
    // the prior insert.
    expect(await store.seenBefore('outage-k')).toBe(true);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]?.[1]).toContain('Redis idempotency store failed');
  });
});

describe('CallbackDeduplicator — legacy sync API', () => {
  it('returns false on first sight, true on second', () => {
    const dedup = new CallbackDeduplicator();
    expect(dedup.seenBefore('legacy-k')).toBe(false);
    expect(dedup.seenBefore('legacy-k')).toBe(true);
  });

  it('tenantKey scopes by tenant', () => {
    const k1 = CallbackDeduplicator.tenantKey('tenant-1', 'stk', 'CHK_001');
    const k2 = CallbackDeduplicator.tenantKey('tenant-2', 'stk', 'CHK_001');
    expect(k1).not.toEqual(k2);
    expect(k1).toBe('tenant-1:stk:CHK_001');
    expect(k2).toBe('tenant-2:stk:CHK_001');
  });

  it('tenantKey falls back to "global" namespace when tenantId is null', () => {
    const k = CallbackDeduplicator.tenantKey(null, 'c2b', 'TRN_001');
    expect(k).toBe('global:c2b:TRN_001');
  });
});

describe('createIdempotencyStore — factory', () => {
  it('returns InMemoryIdempotencyStore when REDIS_URL absent', () => {
    const store = createIdempotencyStore({ redisUrl: undefined });
    expect(store).toBeInstanceOf(InMemoryIdempotencyStore);
  });

  it('returns InMemoryIdempotencyStore when REDIS_URL is empty', () => {
    const store = createIdempotencyStore({ redisUrl: '' });
    expect(store).toBeInstanceOf(InMemoryIdempotencyStore);
  });
});

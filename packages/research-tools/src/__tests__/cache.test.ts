/**
 * Cache layer tests — TTL behaviour, key stability, Redis wrapper.
 */

import { describe, expect, it } from 'vitest';

import {
  buildCacheKey,
  createCache,
  createInMemoryCache,
  createRedisCache,
  type RedisLike,
} from '../cache/redis-cache.js';

describe('createInMemoryCache', () => {
  it('returns null for unknown key', async () => {
    const cache = createInMemoryCache();
    expect(await cache.get('nope')).toBeNull();
  });

  it('roundtrip get/set within TTL', async () => {
    const cache = createInMemoryCache();
    await cache.set('k', 'v', 60);
    expect(await cache.get('k')).toBe('v');
  });

  it('expires after TTL', async () => {
    let now = 0;
    const cache = createInMemoryCache(() => now);
    await cache.set('k', 'v', 5);
    now = 4_999;
    expect(await cache.get('k')).toBe('v');
    now = 5_001;
    expect(await cache.get('k')).toBeNull();
  });

  it('honors ttl=0 as delete', async () => {
    const cache = createInMemoryCache();
    await cache.set('k', 'v', 60);
    await cache.set('k', 'v2', 0);
    expect(await cache.get('k')).toBeNull();
  });
});

describe('createRedisCache', () => {
  it('delegates to the Redis client with prefix', async () => {
    const calls: Array<unknown[]> = [];
    const client: RedisLike = {
      async get(k: string) {
        calls.push(['get', k]);
        return 'val';
      },
      async set(k: string, v: string, mode: 'EX', s: number) {
        calls.push(['set', k, v, mode, s]);
        return 'OK';
      },
    };
    const cache = createRedisCache(client, 'rt:');
    await cache.set('foo', 'bar', 30);
    const out = await cache.get('foo');
    expect(out).toBe('val');
    expect(calls).toEqual([
      ['set', 'rt:foo', 'bar', 'EX', 30],
      ['get', 'rt:foo'],
    ]);
  });

  it('skips write when ttl <= 0', async () => {
    const calls: Array<unknown[]> = [];
    const client: RedisLike = {
      async get() {
        return null;
      },
      async set(...args: unknown[]) {
        calls.push(args);
        return 'OK';
      },
    };
    const cache = createRedisCache(client);
    await cache.set('k', 'v', 0);
    expect(calls).toHaveLength(0);
  });
});

describe('createCache', () => {
  it('returns in-memory when no client provided', async () => {
    const cache = createCache();
    await cache.set('k', 'v', 10);
    expect(await cache.get('k')).toBe('v');
  });

  it('returns redis when client provided', async () => {
    let setCalled = false;
    const client: RedisLike = {
      async get() {
        return 'live';
      },
      async set() {
        setCalled = true;
        return 'OK';
      },
    };
    const cache = createCache({ client });
    await cache.set('k', 'v', 30);
    expect(setCalled).toBe(true);
    expect(await cache.get('k')).toBe('live');
  });
});

describe('buildCacheKey', () => {
  it('is stable across property order', () => {
    const a = buildCacheKey('tavily', { q: 'gold', depth: 'advanced' });
    const b = buildCacheKey('tavily', { depth: 'advanced', q: 'gold' });
    expect(a).toBe(b);
  });

  it('encodes complex values via JSON', () => {
    const key = buildCacheKey('exa', { include: ['arxiv.org', 'lme.com'] });
    expect(key).toContain('include=');
  });

  it('handles null + undefined', () => {
    const key = buildCacheKey('x', { a: null, b: undefined });
    expect(key).toContain('a=');
    expect(key).toContain('b=');
  });
});

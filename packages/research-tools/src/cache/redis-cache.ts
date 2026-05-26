/**
 * Research-tools cache layer.
 *
 * TTL-aware key/value store. Adapters short-circuit on cache hits so the
 * 5-minute price-tick TTL and 1-hour fundamentals TTL from DEEP_RESEARCH_SPEC
 * §5.6 are honoured without round-tripping a paid API.
 *
 * Two implementations:
 *   - createRedisCache({ url }) — production. Wraps ioredis with `EX` TTLs.
 *   - createInMemoryCache()    — fallback when REDIS_URL is absent. Same
 *                                contract, single-process Map.
 *
 * The fallback is intentionally simple (no LRU) — research-tools cache
 * keys are sparse (one entry per query) and the orchestrator service
 * resets between cron runs.
 *
 * @module @borjie/research-tools/cache/redis-cache
 */

import type { Cache } from '../types.js';

// ---------------------------------------------------------------------------
// In-memory cache (default; used when REDIS_URL is unset)
// ---------------------------------------------------------------------------

interface InMemoryEntry {
  readonly value: string;
  readonly expiresAtMs: number;
}

export function createInMemoryCache(now: () => number = Date.now): Cache {
  const store = new Map<string, InMemoryEntry>();

  return {
    async get(key: string): Promise<string | null> {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAtMs <= now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key: string, value: string, ttlSeconds: number): Promise<void> {
      if (ttlSeconds <= 0) {
        store.delete(key);
        return;
      }
      store.set(key, {
        value,
        expiresAtMs: now() + ttlSeconds * 1_000,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Redis cache — production
// ---------------------------------------------------------------------------

/**
 * Minimum Redis surface — matches both ioredis and node-redis. Caller
 * supplies a client (so the package doesn't force a singleton).
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    mode: 'EX',
    seconds: number,
  ): Promise<'OK' | null>;
}

export function createRedisCache(client: RedisLike, keyPrefix = 'rt:'): Cache {
  return {
    async get(key: string): Promise<string | null> {
      return client.get(`${keyPrefix}${key}`);
    },
    async set(key: string, value: string, ttlSeconds: number): Promise<void> {
      if (ttlSeconds <= 0) return;
      await client.set(`${keyPrefix}${key}`, value, 'EX', ttlSeconds);
    },
  };
}

// ---------------------------------------------------------------------------
// Factory — picks Redis when REDIS_URL is set, falls back to in-memory
// ---------------------------------------------------------------------------

export interface CacheFactoryOptions {
  readonly redisUrl?: string;
  readonly client?: RedisLike;
}

/**
 * Returns a Cache. When `client` is provided it's used directly (test
 * injection). Otherwise the caller is expected to wire ioredis itself
 * — we deliberately don't import ioredis here so this package stays
 * tree-shakeable and doesn't force a Redis connection on every
 * consumer.
 *
 * The default in-memory cache is safe for unit tests, single-tenant
 * dev, and CI. Production must pass a client.
 */
export function createCache(options: CacheFactoryOptions = {}): Cache {
  if (options.client) {
    return createRedisCache(options.client);
  }
  return createInMemoryCache();
}

// ---------------------------------------------------------------------------
// Cache-key helpers — stable hashes across adapters
// ===========================================================================

/**
 * Build a deterministic cache key. Adapters call this so the same query
 * + parameters always hits the same key, regardless of object property
 * order.
 */
export function buildCacheKey(
  adapter: string,
  params: Readonly<Record<string, unknown>>,
): string {
  const sortedKeys = Object.keys(params).sort();
  const parts = sortedKeys.map((k) => `${k}=${stringify(params[k])}`);
  return `${adapter}:${parts.join('|')}`;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

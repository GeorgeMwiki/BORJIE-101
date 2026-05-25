/**
 * Market data cache service — Drizzle/Postgres adapter for the
 * `market_data_cache` table created in migration 0120.
 *
 * Caches results from external market-data adapters (Zillow, Airbnb,
 * Rentometer, etc.) so repeated kernel queries within a TTL window do
 * not hammer the upstream provider.
 *
 * Public surface:
 *   1. `get(cacheKey)` — returns the cached entry, or null when missing
 *      OR expired. Hard DB errors degrade to null (with console.error)
 *      so a downed cache never crashes the calling adapter.
 *   2. `put(cacheKey, provider, queryJson, resultJson, ttlMs)` — upserts
 *      the row, computing `expires_at = NOW() + ttlMs`. Replaces any
 *      existing row for the same cache_key.
 *   3. `purgeExpired()` — deletes rows where `expires_at <= NOW()` and
 *      returns the deleted count for observability.
 *
 * The `cache_key` is computed by callers (typically `sha256(provider |
 * normalised query JSON)`) so the same logical query maps to the same
 * row across processes and restarts.
 *
 * Type-shape contract: `resultJson` is opaque `unknown` here; the
 * adapter that wrote it parses/casts on read. We never trust the JSON's
 * shape — schema drift in the upstream is the adapter's problem, not
 * the cache's.
 */

import { eq, lte, sql } from 'drizzle-orm';
import { marketDataCache } from '../schemas/market-data-cache.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';


// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export interface MarketDataCacheEntry {
  /** Opaque payload — the adapter casts on read. */
  readonly resultJson: unknown;
  /** ISO-8601 timestamp the upstream was hit. */
  readonly fetchedAt: string;
}

export interface MarketDataCacheService {
  /**
   * Look up a cache entry. Returns null when the row is missing OR
   * its `expires_at <= NOW()` (callers re-fetch and `put` on miss).
   */
  get(cacheKey: string): Promise<MarketDataCacheEntry | null>;

  /**
   * Upsert a cache entry. `ttlMs` must be positive — `expires_at` is
   * computed as `NOW() + ttlMs`. Replaces any existing row for the
   * same `cacheKey`.
   */
  put(
    cacheKey: string,
    provider: string,
    queryJson: unknown,
    resultJson: unknown,
    ttlMs: number,
  ): Promise<void>;

  /**
   * Sweep expired rows. Returns the count purged for observability.
   * Safe to call on a hot path — uses a single DELETE.
   */
  purgeExpired(): Promise<number>;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createMarketDataCacheService(
  db: DatabaseClient,
): MarketDataCacheService {
  return {
    async get(cacheKey): Promise<MarketDataCacheEntry | null> {
      if (!cacheKey) return null;
      try {
        const rows = await db
          .select({
            resultJson: marketDataCache.resultJson,
            fetchedAt: marketDataCache.fetchedAt,
            expiresAt: marketDataCache.expiresAt,
          })
          .from(marketDataCache)
          .where(eq(marketDataCache.cacheKey, cacheKey))
          .limit(1);

        const hit = Array.isArray(rows) ? rows[0] : undefined;
        if (!hit) return null;

        const expiresAt =
          hit.expiresAt instanceof Date
            ? hit.expiresAt.getTime()
            : new Date(String(hit.expiresAt)).getTime();
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          // Expired — treat as miss so the caller re-fetches.
          return null;
        }

        const fetchedAt =
          hit.fetchedAt instanceof Date
            ? hit.fetchedAt.toISOString()
            : String(hit.fetchedAt);

        return {
          resultJson: hit.resultJson,
          fetchedAt,
        };
      } catch (error) {
        logger.error('market-data-cache.get failed', { error: error });
        return null;
      }
    },

    async put(cacheKey, provider, queryJson, resultJson, ttlMs): Promise<void> {
      if (!cacheKey) {
        throw new Error('market-data-cache.put requires cacheKey');
      }
      if (!provider) {
        throw new Error('market-data-cache.put requires provider');
      }
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
        throw new RangeError(
          `market-data-cache.put requires positive ttlMs; got ${ttlMs}`,
        );
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlMs);

      try {
        const values = {
          cacheKey,
          provider,
          queryJson,
          resultJson,
          fetchedAt: now,
          expiresAt,
        };
        const setOnConflict = {
          provider,
          queryJson,
          resultJson,
          fetchedAt: now,
          expiresAt,
        };
        await db
          .insert(marketDataCache)
          .values(values as never)
          .onConflictDoUpdate({
            target: marketDataCache.cacheKey,
            set: setOnConflict as never,
          });
      } catch (error) {
        logger.error('market-data-cache.put failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('market-data-cache.put failed');
      }
    },

    async purgeExpired(): Promise<number> {
      try {
        const result = await db
          .delete(marketDataCache)
          .where(lte(marketDataCache.expiresAt, sql`NOW()`));
        // Drizzle/postgres-js returns either a numeric `rowCount` or an
        // array result with `count`; normalise defensively.
        const r = result as unknown;
        if (Array.isArray(r)) return r.length;
        if (r && typeof r === 'object') {
          const obj = r as { rowCount?: unknown; count?: unknown };
          if (typeof obj.rowCount === 'number') return obj.rowCount;
          if (typeof obj.count === 'number') return obj.count;
        }
        return 0;
      } catch (error) {
        logger.error('market-data-cache.purgeExpired failed', { error: error });
        return 0;
      }
    },
  };
}

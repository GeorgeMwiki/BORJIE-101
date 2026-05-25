/**
 * Cohort cache — per-tenant + per-jurisdiction cache.
 *
 * Cache keys are namespaced by (tenantId, jurisdiction, key). When we
 * compute something expensive (e.g. a jurisdiction-specific tax table),
 * we cache it per (tenant, jurisdiction). `expiresAt` is checked on
 * read — expired entries return null and are evicted.
 *
 * Invalidation supports an optional key prefix so a tenant can purge a
 * subset of cached values without touching everything.
 */

import type {
  CohortCacheEntry,
  CohortCacheStore,
  Jurisdiction,
  TenantId,
} from '../types.js';

export function createInMemoryCohortCacheStore(): CohortCacheStore {
  const entries = new Map<string, CohortCacheEntry<unknown>>();

  function k(
    tenantId: TenantId,
    jurisdiction: Jurisdiction,
    key: string,
  ): string {
    return `${tenantId}:${jurisdiction ?? '_global_'}:${key}`;
  }

  return {
    async get<TValue>(
      tenantId: TenantId,
      jurisdiction: Jurisdiction,
      key: string,
    ): Promise<CohortCacheEntry<TValue> | null> {
      const cacheKey = k(tenantId, jurisdiction, key);
      const entry = entries.get(cacheKey) as
        | CohortCacheEntry<TValue>
        | undefined;
      if (!entry) return null;
      if (entry.expiresAt) {
        const exp = Date.parse(entry.expiresAt);
        if (Number.isFinite(exp) && exp <= Date.now()) {
          entries.delete(cacheKey);
          return null;
        }
      }
      return entry;
    },

    async set<TValue>(entry: CohortCacheEntry<TValue>): Promise<void> {
      entries.set(
        k(entry.tenantId, entry.jurisdiction, entry.key),
        entry as CohortCacheEntry<unknown>,
      );
    },

    async invalidate(
      tenantId: TenantId,
      jurisdiction: Jurisdiction,
      keyPrefix?: string,
    ): Promise<void> {
      const prefix = k(tenantId, jurisdiction, keyPrefix ?? '');
      for (const key of Array.from(entries.keys())) {
        if (key.startsWith(prefix)) entries.delete(key);
      }
    },
  };
}

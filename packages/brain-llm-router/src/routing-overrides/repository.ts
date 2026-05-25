/**
 * Routing-override repository.
 *
 * Wraps an `OverridePort` adapter with:
 *   - per-tenant in-memory cache (warmed lazily via `warm()`).
 *   - sync `getOverrideFor()` for hot path.
 *   - async write methods that invalidate the cache.
 *
 * Hot-path call site:
 *
 *     const override = repo.getOverrideFor(tenantId, taskCategory)
 *     if (override) family = override.family
 *
 * Lifecycle:
 *   1. Composition root constructs `new RoutingOverrideRepository(adapter)`.
 *   2. Background worker calls `await repo.warm(tenantId)` per tenant
 *      on first touch.
 *   3. Resolver hot path calls `repo.getOverrideFor(...)` synchronously.
 *   4. Admin PATCH route calls `await repo.upsert(...)` — cache for
 *      that tenant is invalidated, next warm refreshes.
 */

import type { ModelFamily } from '../dynamic-registry/baselines.js';
import type { OverridePort, RoutingOverride } from './override-port.js';
import { LOCKED_CATEGORIES, type RoutingOverrideEntry } from './schema.js';

/**
 * Cached overrides for one tenant: a map keyed on taskCategory.
 * `null` value means "warm in progress — assume no override".
 */
type TenantCacheEntry = Map<string, RoutingOverride>;

export class RoutingOverrideRepository {
  private readonly adapter: OverridePort;
  private readonly cache = new Map<string, TenantCacheEntry>();
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(adapter: OverridePort) {
    this.adapter = adapter;
  }

  /**
   * Hot-path lookup. Synchronous. Returns null when:
   *   - cache hasn't been warmed for this tenant yet, OR
   *   - the category is locked (defense-in-depth — should also be
   *     caught at the PATCH validator), OR
   *   - no override is registered for the category.
   */
  getOverrideFor(
    tenantId: string,
    taskCategory: string,
  ): RoutingOverride | null {
    if (LOCKED_CATEGORIES.has(taskCategory)) return null;
    const tenantCache = this.cache.get(tenantId);
    if (!tenantCache) return null;
    return tenantCache.get(taskCategory) ?? null;
  }

  /**
   * Warm the cache for `tenantId`. Deduplicates concurrent callers.
   * Safe to call repeatedly.
   */
  async warm(tenantId: string): Promise<void> {
    const inflight = this.inflight.get(tenantId);
    if (inflight) return inflight;
    const p = (async () => {
      try {
        const entries = await this.adapter.listForTenant(tenantId);
        const tenantCache = new Map<string, RoutingOverride>();
        for (const e of entries) {
          // Defense-in-depth: skip locked categories even if they got
          // into the DB somehow.
          if (LOCKED_CATEGORIES.has(e.taskCategory)) continue;
          tenantCache.set(e.taskCategory, {
            family: e.family,
            reason: e.reason,
          });
        }
        this.cache.set(tenantId, tenantCache);
      } finally {
        this.inflight.delete(tenantId);
      }
    })();
    this.inflight.set(tenantId, p);
    return p;
  }

  /**
   * Upsert an override and invalidate the cache for `tenantId`. Caller
   * should re-`warm()` after this if they need immediate visibility.
   */
  async upsert(opts: {
    tenantId: string;
    taskCategory: string;
    family: ModelFamily;
    reason: string;
  }): Promise<void> {
    if (LOCKED_CATEGORIES.has(opts.taskCategory)) {
      throw new Error(
        `[routing-override] category "${opts.taskCategory}" is locked`,
      );
    }
    const entry: RoutingOverrideEntry = {
      ...opts,
      createdAtMs: Date.now(),
    };
    await this.adapter.upsert(entry);
    this.cache.delete(opts.tenantId);
  }

  /**
   * Remove an override and invalidate the cache for `tenantId`.
   */
  async remove(tenantId: string, taskCategory: string): Promise<boolean> {
    const deleted = await this.adapter.delete(tenantId, taskCategory);
    if (deleted) this.cache.delete(tenantId);
    return deleted;
  }

  /** Test hook — wipe the cache. */
  clearCache(): void {
    this.cache.clear();
    this.inflight.clear();
  }
}

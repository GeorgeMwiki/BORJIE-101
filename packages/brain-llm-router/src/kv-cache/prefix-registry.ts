/**
 * kv-cache/prefix-registry — SCAFFOLD (LP-12, experimental tail).
 *
 * Ported (shape) from LITFIN `src/core/ai/kv-cache/prefix-registry.ts`.
 *
 * Shares one provider prompt-cache id across sibling requests that send the
 * SAME long system prompt. Providers charge full price on the first call (cache
 * write) and a fraction on cached reads within the TTL; without coordination
 * parallel callers each spin a separate cache entry. This registry dedups them.
 *
 * Key: FNV-1a of `${modelId}|${systemPrompt}` (no crypto dep, consistent with
 * the rest of this package). The system prompt is NOT whitespace-normalised —
 * any meaningful change gets its own cache id (correct, if conservative).
 *
 * STATUS: typed interface + a minimal in-memory LRU implementation. Cross-process
 * telemetry persistence and tier-policy gating are deferred.
 *
 * TODO(LP-12): add a cross-replica telemetry sink (hit/miss/eviction rows) and
 *   wire TTL expiry to the provider's actual cache window. See LITFIN ref.
 *
 * Process-local, zero blocking I/O on the read path.
 */

import { fnv1a } from '../eval-drift-logger/event.js';

export interface PrefixCacheEntry {
  readonly key: string;
  readonly cacheId: string;
  readonly tenantId: string | null;
  hits: number;
  lastUsedMs: number;
}

export interface PrefixLookupArgs {
  readonly modelId: string;
  readonly systemPrompt: string;
}

export interface PrefixAssignArgs extends PrefixLookupArgs {
  readonly cacheId: string;
  readonly tenantId?: string | null;
}

export interface PrefixHitOrMiss {
  readonly outcome: 'hit' | 'miss';
  readonly key: string;
  readonly entry: PrefixCacheEntry | null;
}

export interface PrefixRegistryStats {
  readonly entries: number;
  readonly totalHits: number;
  readonly evictions: number;
}

const DEFAULT_MAX_ENTRIES = 256;

/** Build the cache key from model id + exact system prompt. */
export function prefixKey(args: PrefixLookupArgs): string {
  return fnv1a(`${args.modelId}|${args.systemPrompt}`);
}

/**
 * In-memory LRU registry of system-prompt → shared cache id. Minimal but
 * correct: `lookup` is a pure read; `assign` inserts/refreshes and evicts the
 * least-recently-used entry past `maxEntries`.
 */
export class KvPrefixRegistry {
  private readonly entries = new Map<string, PrefixCacheEntry>();
  private readonly maxEntries: number;
  private readonly now: () => number;
  private evictions = 0;

  constructor(opts: { maxEntries?: number; now?: () => number } = {}) {
    this.maxEntries = opts.maxEntries && opts.maxEntries > 0 ? opts.maxEntries : DEFAULT_MAX_ENTRIES;
    this.now = opts.now ?? Date.now;
  }

  lookup(args: PrefixLookupArgs): PrefixHitOrMiss {
    const key = prefixKey(args);
    const entry = this.entries.get(key);
    if (!entry) return { outcome: 'miss', key, entry: null };
    // Refresh recency on hit.
    entry.hits += 1;
    entry.lastUsedMs = this.now();
    return { outcome: 'hit', key, entry };
  }

  assign(args: PrefixAssignArgs): PrefixCacheEntry {
    const key = prefixKey(args);
    const existing = this.entries.get(key);
    if (existing) {
      existing.lastUsedMs = this.now();
      return existing;
    }
    const entry: PrefixCacheEntry = {
      key,
      cacheId: args.cacheId,
      tenantId: args.tenantId ?? null,
      hits: 0,
      lastUsedMs: this.now(),
    };
    this.entries.set(key, entry);
    this.evictIfNeeded();
    return entry;
  }

  private evictIfNeeded(): void {
    while (this.entries.size > this.maxEntries) {
      // Find the least-recently-used entry.
      let oldestKey: string | null = null;
      let oldestTs = Infinity;
      for (const [k, e] of this.entries) {
        if (e.lastUsedMs < oldestTs) {
          oldestTs = e.lastUsedMs;
          oldestKey = k;
        }
      }
      if (oldestKey === null) break;
      this.entries.delete(oldestKey);
      this.evictions += 1;
    }
  }

  stats(): PrefixRegistryStats {
    let totalHits = 0;
    for (const e of this.entries.values()) totalHits += e.hits;
    return { entries: this.entries.size, totalHits, evictions: this.evictions };
  }

  reset(): void {
    this.entries.clear();
    this.evictions = 0;
  }
}

/** Opt-in flag (on unless explicitly disabled, mirroring LITFIN's default-on). */
export function isKvCacheHotSwapEnabled(): boolean {
  return process.env.BORJIE_KV_CACHE_HOT_SWAP !== '0';
}

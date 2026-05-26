/**
 * `cache-policy.ts` — TTL handling for ephemeral dashboards.
 *
 * Pure data structure with an injectable `now()` for deterministic
 * tests. In-memory only — no durable storage. Bounded LRU.
 */
import type { ComposeCacheEntry, ComposeCacheKey } from '../types.js';

const DEFAULT_CAPACITY = 8192;

export interface ComposeCache {
  readonly get: (k: ComposeCacheKey) => ComposeCacheEntry | null;
  readonly put: (k: ComposeCacheKey, e: ComposeCacheEntry) => void;
  readonly size: () => number;
  readonly clear: () => void;
}

function keyString(k: ComposeCacheKey): string {
  return [
    k.function_id,
    k.manifest_version,
    k.function_input_hash,
    k.user_context_hash,
    k.brand_tokens_version,
  ].join('|');
}

/**
 * Creates a bounded LRU compose cache. `nowMs` is injected so tests can
 * advance time deterministically.
 */
export function createComposeCache(options?: {
  readonly capacity?: number;
  readonly nowMs?: () => number;
}): ComposeCache {
  const capacity = options?.capacity ?? DEFAULT_CAPACITY;
  const now = options?.nowMs ?? (() => Date.now());
  const store = new Map<string, ComposeCacheEntry>();

  function evictIfNeeded(): void {
    while (store.size > capacity) {
      const oldestKey = store.keys().next().value;
      if (oldestKey === undefined) return;
      store.delete(oldestKey);
    }
  }

  return {
    get(k) {
      const ks = keyString(k);
      const e = store.get(ks);
      if (!e) return null;
      if (e.expires_at <= now()) {
        store.delete(ks);
        return null;
      }
      // LRU bump: re-insert.
      store.delete(ks);
      store.set(ks, e);
      return e;
    },
    put(k, e) {
      const ks = keyString(k);
      store.delete(ks);
      store.set(ks, e);
      evictIfNeeded();
    },
    size() {
      return store.size;
    },
    clear() {
      store.clear();
    },
  };
}

/** Pure helper: computes an `expires_at` from a TTL + a `cached_at`. */
export function computeExpiresAt(
  cached_at: number,
  ttl_seconds: number,
): number {
  if (ttl_seconds <= 0) {
    // 0 means "never cache"; expires immediately on the next tick.
    return cached_at;
  }
  return cached_at + ttl_seconds * 1000;
}

/** Returns true if the entry has expired relative to `nowMs`. */
export function isExpired(e: ComposeCacheEntry, nowMs: number): boolean {
  return e.expires_at <= nowMs;
}

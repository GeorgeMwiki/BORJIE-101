/**
 * Dynamic model registry — L1 in-memory TTL cache.
 *
 * Single process-wide `Map` keyed by `ModelFamily`. Each entry carries
 * an `expiresAt` epoch-ms; reads return `null` once the value has aged
 * out so the resolver knows to schedule an L2 refresh.
 *
 * No external deps — Node `Date.now()` only, so the cache works in
 * tests, prod, and the sleep-pass warm path without provisioning.
 *
 * TTL: defaults to 1 h, env-overridable via
 * `BORJIE_MODEL_CACHE_TTL_MS`. The resolver passes its own TTL
 * when caching a baseline after an L2 miss (shorter, to retry sooner).
 *
 * Test override: `clear()` resets the whole map; `setNowFn()` /
 * `clearNowFn()` let tests freeze time for TTL-expiry assertions
 * without needing a fake clock library.
 */

import type { ModelFamily } from './baselines.js';

export interface CacheEntry {
  readonly value: string;
  readonly expiresAt: number;
}

const DEFAULT_TTL_MS_FALLBACK = 60 * 60 * 1000;

/**
 * Read the default TTL from env at first call. Cached after first read
 * to avoid repeated process.env access on the hot path.
 */
let defaultTtlMsCached: number | null = null;
function readDefaultTtlMs(): number {
  if (defaultTtlMsCached !== null) return defaultTtlMsCached;
  const raw = process.env.BORJIE_MODEL_CACHE_TTL_MS;
  const parsed = raw === undefined ? NaN : Number(raw);
  defaultTtlMsCached =
    Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_MS_FALLBACK;
  return defaultTtlMsCached;
}

const store = new Map<ModelFamily, CacheEntry>();

/**
 * Test-only hook: lets tests freeze time so TTL expiry can be asserted
 * without `vi.useFakeTimers()` or sleeping. Production code never calls
 * this — `now()` falls through to `Date.now()`.
 */
let nowFn: () => number = () => Date.now();

export function get(family: ModelFamily): string | null {
  const entry = store.get(family);
  if (entry === undefined) return null;
  if (entry.expiresAt <= nowFn()) {
    store.delete(family);
    return null;
  }
  return entry.value;
}

export function set(
  family: ModelFamily,
  value: string,
  ttlMs?: number,
): void {
  const effectiveTtl =
    typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : readDefaultTtlMs();
  store.set(family, {
    value,
    expiresAt: nowFn() + effectiveTtl,
  });
}

/** Wipe the entire cache. Used by tests + admin "drop cache" endpoints. */
export function clear(): void {
  store.clear();
}

/** Test-only: number of live entries. */
export function size(): number {
  return store.size;
}

/** Test-only: override the time source so TTL expiry is deterministic. */
export function setNowFn(fn: () => number): void {
  nowFn = fn;
}

/** Test-only: restore the real time source. */
export function clearNowFn(): void {
  nowFn = () => Date.now();
}

/** Test-only: reset the cached default TTL so env changes are picked up. */
export function resetDefaultTtlCache(): void {
  defaultTtlMsCached = null;
}

export const cache = {
  get,
  set,
  clear,
  size,
  setNowFn,
  clearNowFn,
  resetDefaultTtlCache,
};

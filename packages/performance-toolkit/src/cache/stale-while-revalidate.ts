/**
 * `staleWhileRevalidate` — in-process SWR wrapper for any async
 * function. Returns the fresh value on miss; returns stale value
 * AND kicks off a background refetch when within the SWR window;
 * blocks for a fresh fetch when past the SWR window.
 *
 * Classic pattern — used by HTTP RFC 5861, Cloudflare/Fastly edge
 * cache, TanStack Query, react-query and SWR (the npm library).
 * Source: web.dev/learn/pwa/workbox + tanstack.com/query/v5.
 *
 *   const cached = staleWhileRevalidate({
 *     fetchFn: () => fetchTenantConfig(tid),
 *     ttlMs: 30_000,
 *     swrMs: 300_000,
 *   });
 *   const cfg = await cached(); // hits the cache logic
 */

import type { SWROptions } from '../types.js';

interface CachedEntry<T> {
  value: T;
  fetchedAt: number;
}

export function staleWhileRevalidate<T>(opts: SWROptions<T>): () => Promise<T> {
  if (opts.ttlMs <= 0) throw new Error('staleWhileRevalidate: ttlMs must be > 0');
  if (opts.swrMs < opts.ttlMs) {
    throw new Error('staleWhileRevalidate: swrMs must be >= ttlMs');
  }
  let cached: CachedEntry<T> | null = null;
  let inflight: Promise<T> | null = null;

  const refresh = async (): Promise<T> => {
    if (inflight !== null) return inflight;
    inflight = opts
      .fetchFn()
      .then((value) => {
        cached = { value, fetchedAt: Date.now() };
        inflight = null;
        return value;
      })
      .catch((err) => {
        inflight = null;
        throw err;
      });
    return inflight;
  };

  return async function getter(): Promise<T> {
    const now = Date.now();
    if (cached === null) return refresh();
    const ageMs = now - cached.fetchedAt;
    if (ageMs <= opts.ttlMs) {
      // Fresh — no fetch needed.
      return cached.value;
    }
    if (ageMs <= opts.swrMs) {
      // Stale-but-acceptable — return stale + kick off background refetch.
      void refresh().catch(() => {
        // Background refetch failure shouldn't poison the current call.
      });
      return cached.value;
    }
    // Beyond SWR — must wait for fresh.
    return refresh();
  };
}

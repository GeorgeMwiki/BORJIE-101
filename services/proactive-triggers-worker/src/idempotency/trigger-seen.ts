/**
 * In-memory idempotency cache for trigger keys.
 *
 * Production swaps this for a Redis-backed implementation so multiple
 * worker instances share state. The interface is the same so the swap
 * is a one-line change at the composition root.
 */
import type { IdempotencyCache } from '../types.js';

interface CacheEntry {
  expiresAt: number;
}

/**
 * Simple time-bucketed cache. Each `markSeen` records the trigger key
 * with an expiry; `hasSeenRecently` checks whether the entry's expiry
 * is still in the future.
 *
 * Eviction is lazy — on read we drop expired entries.
 */
export class InMemoryIdempotencyCache implements IdempotencyCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly clock: () => number;

  constructor(clock: () => number = () => Date.now()) {
    this.clock = clock;
  }

  hasSeenRecently(triggerKey: string, withinHours: number): boolean {
    const entry = this.entries.get(triggerKey);
    if (!entry) return false;
    if (entry.expiresAt <= this.clock()) {
      this.entries.delete(triggerKey);
      return false;
    }
    // The hit is "recent" only if the existing TTL is still within the
    // caller's lookback window.
    const remainingHours = (entry.expiresAt - this.clock()) / (1000 * 60 * 60);
    return remainingHours >= 0 && remainingHours <= withinHours + 0.01;
  }

  markSeen(triggerKey: string, withinHours: number): void {
    const ttlMs = withinHours * 60 * 60 * 1000;
    this.entries.set(triggerKey, { expiresAt: this.clock() + ttlMs });
  }

  /** Diagnostic — current cache size. */
  size(): number {
    return this.entries.size;
  }
}

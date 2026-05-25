/**
 * Rate-limit store port.
 *
 * The same algorithm code runs on top of in-memory state today and a
 * Redis-backed state in distributed deploys. The port intentionally
 * exposes ONLY the primitives Redis can do atomically:
 *
 *   - tokenBucket: `getOrCreate(key, defaults)` + `compareAndSet`
 *   - slidingWindow: `pushTimestamp` + `pruneAndCount`
 *   - fixedWindow: `incrCounterWithExpiry`
 *
 * That keeps the Redis adapter (port-only here) ~50 lines:
 *   tokenBucket → Lua script with EVAL
 *   slidingWindow → ZADD + ZREMRANGEBYSCORE + ZCARD
 *   fixedWindow → INCR with EXPIRE
 */

/* -------------------------------------------------------------------------- */
/* Generic key/value primitives                                               */
/* -------------------------------------------------------------------------- */

export interface RateLimitStore {
  // Token-bucket primitives
  getBucket(key: string): Promise<TokenBucketState | null>;
  setBucket(key: string, state: TokenBucketState): Promise<void>;

  // Sliding-window primitives (log of timestamps)
  pushTimestamp(key: string, ts: number, windowMs: number): Promise<void>;
  pruneAndCount(key: string, now: number, windowMs: number): Promise<number>;

  // Fixed-window primitives
  incrCounter(key: string, windowMs: number, now: number): Promise<number>;
}

export interface TokenBucketState {
  readonly tokens: number;
  readonly lastRefillAt: number;
}

/* -------------------------------------------------------------------------- */
/* In-memory store — default. Process-local; sufficient for dev + single-pod.  */
/* -------------------------------------------------------------------------- */

interface CounterEntry {
  count: number;
  resetAt: number;
}

export function createInMemoryRateLimitStore(): RateLimitStore {
  const buckets = new Map<string, TokenBucketState>();
  const slidingLogs = new Map<string, number[]>();
  const counters = new Map<string, CounterEntry>();

  return {
    async getBucket(key) {
      return buckets.get(key) ?? null;
    },
    async setBucket(key, state) {
      buckets.set(key, state);
    },
    async pushTimestamp(key, ts, _windowMs) {
      const arr = slidingLogs.get(key);
      if (arr) arr.push(ts);
      else slidingLogs.set(key, [ts]);
    },
    async pruneAndCount(key, now, windowMs) {
      const arr = slidingLogs.get(key);
      if (!arr) return 0;
      const cutoff = now - windowMs;
      let i = 0;
      while (i < arr.length && (arr[i] ?? 0) <= cutoff) i++;
      if (i > 0) arr.splice(0, i);
      return arr.length;
    },
    async incrCounter(key, windowMs, now) {
      const existing = counters.get(key);
      if (!existing || existing.resetAt <= now) {
        const fresh: CounterEntry = { count: 1, resetAt: now + windowMs };
        counters.set(key, fresh);
        return 1;
      }
      existing.count += 1;
      return existing.count;
    },
  };
}

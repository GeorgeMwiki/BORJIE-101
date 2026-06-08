/**
 * Distributed token-bucket rate limiter (RSS-08).
 *
 * Why this exists
 * ───────────────
 * The per-route limiters in `rate-limiter.ts` (`perUserRateLimit`,
 * `customRateLimit`) keep their state in a process-local `Map`. With the
 * api-gateway scaling 3-N replicas behind HPA, that makes the effective cap
 * `max * replicas` — a 30/min cap silently becomes 30*N/min at peak, which
 * breaks both abuse-prevention and tenant-fairness guarantees in the SLA.
 *
 * The fix is the SOTA-canonical model for a distributed token bucket: hold
 * the bucket state in Redis (shared across replicas) and run the whole
 * refill-check-consume cycle as ONE atomic `EVAL` Lua script. Doing the
 * read-modify-write in three round-trips would let two replicas race the
 * counter; the single `EVAL` collapses it into one server-side critical
 * section so the cap is exact regardless of replica count.
 *
 * Algorithm (token bucket)
 * ────────────────────────
 *   - Each key holds `{tokens, ts}` where `ts` is the last-refill epoch (ms).
 *   - On each request: refill `tokens += elapsedSec * refillRatePerSec`,
 *     capped at `capacity`; if `tokens >= 1` consume one and allow, else
 *     deny and report the seconds until the next token (`retryAfter`).
 *   - The hash is `PEXPIRE`d to `ceil(capacity / refillRate) * 2 * 1000`ms so
 *     idle keys self-evict (a fully-drained bucket needs at most
 *     `capacity / refillRate` seconds to refill; ×2 is the safety margin).
 *
 * Atomicity proof
 * ───────────────
 * Redis executes a single `EVAL` script to completion without interleaving
 * any other command (single-threaded command loop). Therefore the refill +
 * compare + decrement + store is indivisible: two concurrent replicas hitting
 * the same key are serialised by Redis, so the sum of grants across all
 * replicas can never exceed `capacity` (plus the time-based refill). This is
 * the property the process-local `Map` cannot provide.
 *
 * Fallback / failure posture
 * ──────────────────────────
 * This module owns ONLY the Redis path. The caller (`rate-limiter.ts`) decides
 * whether to construct it (gate: presence of `process.env.REDIS_URL`) and what
 * to do when a `consume()` call rejects — `rate-limiter.ts` mirrors the
 * established degrade/Sentry signal from `rate-limit-redis.middleware.ts` and
 * falls back to the in-process limiter so a Redis blip never hard-fails a
 * request.
 *
 * No `process.env` is read here outside a constructor/factory boundary; the
 * redis client is injected, matching `per-tenant-rate-budget.ts`.
 */

import type { Redis as IoRedisClient } from 'ioredis';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Narrow surface of ioredis this module needs (eval). Keeps tests hermetic. */
export interface EvalCapableRedis {
  eval(
    script: string,
    numKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
}

export interface TokenBucketParams {
  /** Maximum tokens the bucket can hold (the burst ceiling). */
  readonly capacity: number;
  /** Steady-state refill rate in tokens per second. */
  readonly refillRatePerSec: number;
}

export interface TokenBucketDecision {
  /** Whether a token was consumed (request permitted). */
  readonly allowed: boolean;
  /** Whole tokens remaining in the bucket after this call. */
  readonly remaining: number;
  /** Seconds until the next token is available (only meaningful when denied). */
  readonly retryAfter: number;
}

export interface RedisTokenBucketOptions {
  /** Connected, eval-capable redis client (ioredis or a hermetic fake). */
  readonly redis: EvalCapableRedis;
  /** Key namespace so different limiters never collide. Defaults to `tb`. */
  readonly keyPrefix?: string;
  /** Injectable clock (ms epoch) for deterministic tests. Defaults to Date.now. */
  readonly clock?: () => number;
}

// ---------------------------------------------------------------------------
// Lua script — atomic refill + check + consume.
// ---------------------------------------------------------------------------

/**
 * KEYS[1] = bucket key.
 * ARGV[1] = capacity (max tokens).
 * ARGV[2] = refillRatePerSec.
 * ARGV[3] = nowMs (caller clock; Redis TIME is avoided so tests are
 *           deterministic and clock skew is the caller's single source).
 * ARGV[4] = ttlMs (PEXPIRE so idle buckets self-evict).
 *
 * Returns { allowedFlag, remainingWholeTokens, retryAfterSeconds }.
 *
 * The whole body runs as one indivisible Redis command — no other client can
 * observe or mutate the key mid-script, so the cross-replica cap is exact.
 */
const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  ts = now
end

-- Refill based on elapsed wall-clock time (never negative; clamp at capacity).
local elapsed = now - ts
if elapsed < 0 then elapsed = 0 end
tokens = tokens + (elapsed / 1000.0) * refill
if tokens > capacity then tokens = capacity end

local allowed = 0
local retry_after = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  -- Seconds until the bucket holds one whole token again.
  if refill > 0 then
    retry_after = math.ceil((1 - tokens) / refill)
  else
    retry_after = 1
  end
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, ttl)

-- Report whole remaining tokens (floor) so headers never over-promise.
return { allowed, math.floor(tokens), retry_after }
`;

// ---------------------------------------------------------------------------
// RedisTokenBucket
// ---------------------------------------------------------------------------

/**
 * A distributed token bucket. One instance is shared by all replicas via the
 * injected redis client; `consume(key, params)` is the only hot-path call.
 */
export class RedisTokenBucket {
  private readonly redis: EvalCapableRedis;
  private readonly keyPrefix: string;
  private readonly clock: () => number;

  constructor(options: RedisTokenBucketOptions) {
    this.redis = options.redis;
    this.keyPrefix = options.keyPrefix ?? 'tb';
    this.clock = options.clock ?? Date.now;
  }

  /**
   * Atomically refill + attempt-consume one token for `key`.
   *
   * Rejects only when the Redis call itself fails — the caller treats a
   * rejection as the signal to degrade to its in-process fallback.
   */
  async consume(
    key: string,
    params: TokenBucketParams,
  ): Promise<TokenBucketDecision> {
    const capacity = Math.max(1, Math.floor(params.capacity));
    const refill = params.refillRatePerSec > 0 ? params.refillRatePerSec : 0;
    const now = this.clock();
    // A drained bucket refills fully in capacity/refill seconds; ×2 margin.
    const ttlMs =
      refill > 0
        ? Math.ceil((capacity / refill) * 2) * 1000
        : capacity * 2 * 1000;
    const fullKey = `${this.keyPrefix}:${key}`;

    const raw = await this.redis.eval(
      TOKEN_BUCKET_LUA,
      1,
      fullKey,
      capacity,
      refill,
      now,
      Math.max(1000, ttlMs),
    );

    return parseDecision(raw);
  }
}

// ---------------------------------------------------------------------------
// Result parsing — ioredis returns Lua tables as arrays of (mostly) numbers,
// but the wire types are loose, so coerce defensively.
// ---------------------------------------------------------------------------

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === 'bigint') return Number(value);
  return 0;
}

/** Convert the Lua `{allowed, remaining, retryAfter}` array into a decision. */
export function parseDecision(raw: unknown): TokenBucketDecision {
  if (!Array.isArray(raw) || raw.length < 3) {
    throw new Error(
      `redis-token-bucket: unexpected EVAL result ${JSON.stringify(raw)}`,
    );
  }
  const allowed = toNumber(raw[0]) === 1;
  const remaining = Math.max(0, Math.floor(toNumber(raw[1])));
  const retryAfter = Math.max(0, Math.floor(toNumber(raw[2])));
  return { allowed, remaining, retryAfter };
}

/**
 * Build a `RedisTokenBucket` from a concrete ioredis client. Thin convenience
 * wrapper so `rate-limiter.ts` does not depend on the constructor shape; the
 * client must already be connected/constructed by the caller.
 */
export function createRedisTokenBucket(
  redis: IoRedisClient | EvalCapableRedis,
  options?: Omit<RedisTokenBucketOptions, 'redis'>,
): RedisTokenBucket {
  return new RedisTokenBucket({ redis: redis as EvalCapableRedis, ...options });
}

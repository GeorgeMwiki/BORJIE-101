/**
 * concurrency-gate/upstash-store — Redis/Upstash-backed `ConcurrencyStore`.
 *
 * Ported from LITFIN `src/core/ai/concurrency-gate-redis.ts`.
 *
 * ATOMICITY: Redis Lua eval is single-threaded, so the GET → INCR → EXPIRE
 * script runs uninterrupted. The "check capacity then increment" race the
 * in-memory path solves with the Map being synchronous is solved here by Redis
 * itself. The Upstash REST endpoint serialises eval calls per instance.
 *
 * TTL guard: if a holder crashes after INCR but before DECR, the counter would
 * leak forever; the EXPIRE caps any leak at `ttlSeconds`.
 *
 * TRANSPORT IS A PORT: leaf logic here never imports the `@upstash/redis` SDK
 * or calls `fetch` directly. The composition root injects a `RedisEvalPort`
 * (typically a 5-line Upstash REST POST). This keeps the package
 * zero-runtime-dep and unit-testable with a fake eval.
 */

import type { ConcurrencyStore } from './store-port.js';

/**
 * Injected Redis transport. `eval` runs a Lua script with KEYS + ARGV and
 * returns whatever the script returns (a number for our scripts). May reject
 * on transport failure — the store maps a rejection to `false` (a miss).
 */
export interface RedisEvalPort {
  eval(script: string, keys: readonly string[], args: readonly string[]): Promise<unknown>;
}

/** Optional structured logger for transport blips (no-op default). */
export interface UpstashStoreLogger {
  warn(context: Record<string, unknown>, message: string): void;
}

const NOOP_LOGGER: UpstashStoreLogger = { warn() {} };

const DEFAULT_KEY_PREFIX = 'borjie:llm:gate:';

/**
 * Lua: atomically check capacity, then INCR + EXPIRE. Returns the new value
 * (>= 1) on grant, or -1 if at/above capacity. Single-threaded eval guarantees
 * no two acquirers race the GET → INCR window.
 */
export const ACQUIRE_LUA = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current >= tonumber(ARGV[1]) then
  return -1
end
local next_val = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return next_val
`.trim();

/** Lua: clamp DECR at zero so a stale release after TTL expiry cannot go negative. */
export const RELEASE_LUA = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current > 0 then
  redis.call('DECR', KEYS[1])
end
return 1
`.trim();

export interface UpstashStoreOptions {
  readonly eval: RedisEvalPort;
  /** Key namespace. Default 'borjie:llm:gate:'. */
  readonly keyPrefix?: string;
  readonly logger?: UpstashStoreLogger;
}

/**
 * Redis/Upstash-backed store. Atomic acquire/release via injected Lua eval.
 * Transport errors resolve as a miss (`false`) on acquire and are swallowed on
 * release (the TTL guard is the safety net) — the gate's outage fallback in
 * `store-backed-gate.ts` handles the harder all-calls-failing case.
 */
export class UpstashConcurrencyStore implements ConcurrencyStore {
  private readonly evalPort: RedisEvalPort;
  private readonly keyPrefix: string;
  private readonly logger: UpstashStoreLogger;

  constructor(opts: UpstashStoreOptions) {
    this.evalPort = opts.eval;
    this.keyPrefix = opts.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.logger = opts.logger ?? NOOP_LOGGER;
  }

  private redisKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async tryAcquire(key: string, capacity: number, ttlSeconds: number): Promise<boolean> {
    const cap = Math.max(1, capacity);
    try {
      const result = await this.evalPort.eval(
        ACQUIRE_LUA,
        [this.redisKey(key)],
        [String(cap), String(ttlSeconds)],
      );
      const n = typeof result === 'number' ? result : Number.parseInt(String(result), 10);
      // We do NOT grant on a non-finite / error result — granting on error
      // defeats the gate. Caller retries until timeout.
      return Number.isFinite(n) && n > 0;
    } catch (err) {
      this.logger.warn(
        { key, error: err instanceof Error ? err.message : String(err) },
        'concurrency-gate Upstash acquire failed; treating as miss',
      );
      return false;
    }
  }

  async release(key: string): Promise<void> {
    try {
      await this.evalPort.eval(RELEASE_LUA, [this.redisKey(key)], []);
    } catch (err) {
      this.logger.warn(
        { key, error: err instanceof Error ? err.message : String(err) },
        'concurrency-gate Upstash release failed; TTL guard will reclaim',
      );
      // Swallow — the EXPIRE on the key reclaims the slot within ttlSeconds.
    }
  }
}

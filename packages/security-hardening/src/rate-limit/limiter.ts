/**
 * Pluggable rate limiter.
 *
 * Three algorithms — chosen at factory time:
 *
 *   tokenBucket   — bursty traffic, smooth refill.   capacity + refillPerMs.
 *   slidingWindow — exact rolling window.            limit + windowMs.
 *   fixedWindow   — cheapest, has edge-bursts.        limit + windowMs.
 *
 * Keys are composable — the caller passes a `keyOf(req) -> string` that
 * combines per-IP / per-user / per-route as appropriate.
 *
 *   keyOf: (r) => `${r.userId}:${r.route}`                  // per-user
 *   keyOf: (r) => `${r.ip}:${r.route}`                      // per-IP
 *   keyOf: (r) => `${r.userId ?? r.ip}:${r.route}`          // user → IP fallback
 */

import type {
  RateLimitAlgorithm,
  RateLimitDecision,
} from '../types.js';
import type { RateLimitStore } from './store.js';

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export interface TokenBucketLimits {
  readonly algorithm: 'tokenBucket';
  /** Max tokens in the bucket — controls burst size. */
  readonly capacity: number;
  /** Tokens added per millisecond. e.g. 100 req/min = 100/60000 ≈ 0.00167. */
  readonly refillPerMs: number;
}

export interface WindowLimits {
  readonly algorithm: 'slidingWindow' | 'fixedWindow';
  readonly limit: number;
  readonly windowMs: number;
}

export type RateLimitLimits = TokenBucketLimits | WindowLimits;

export interface RateLimiterOptions {
  readonly algorithm: RateLimitAlgorithm;
  readonly store: RateLimitStore;
  readonly limits: RateLimitLimits;
  readonly now?: () => number;
}

export interface RateLimiter {
  readonly algorithm: RateLimitAlgorithm;
  consume(key: string, cost?: number): Promise<RateLimitDecision>;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  if (opts.algorithm !== opts.limits.algorithm) {
    throw new Error(
      `algorithm mismatch: ${opts.algorithm} vs limits.algorithm=${opts.limits.algorithm}`,
    );
  }
  const now = opts.now ?? Date.now;

  if (opts.limits.algorithm === 'tokenBucket') {
    return makeTokenBucketLimiter(opts.store, opts.limits, now);
  }
  if (opts.limits.algorithm === 'slidingWindow') {
    return makeSlidingWindowLimiter(opts.store, opts.limits, now);
  }
  return makeFixedWindowLimiter(opts.store, opts.limits, now);
}

/* -------------------------------------------------------------------------- */
/* Token bucket                                                               */
/* -------------------------------------------------------------------------- */

function makeTokenBucketLimiter(
  store: RateLimitStore,
  limits: TokenBucketLimits,
  now: () => number,
): RateLimiter {
  return {
    algorithm: 'tokenBucket',
    async consume(key, cost = 1) {
      const t = now();
      const current = (await store.getBucket(key)) ?? {
        tokens: limits.capacity,
        lastRefillAt: t,
      };
      const elapsed = Math.max(0, t - current.lastRefillAt);
      const refilled = Math.min(
        limits.capacity,
        current.tokens + elapsed * limits.refillPerMs,
      );
      if (refilled < cost) {
        // Not enough tokens. Persist the refilled state so the next call
        // doesn't double-count refill time.
        await store.setBucket(key, { tokens: refilled, lastRefillAt: t });
        const deficit = cost - refilled;
        const retryAfterMs = Math.ceil(deficit / limits.refillPerMs);
        return {
          allowed: false,
          remaining: 0,
          limit: limits.capacity,
          resetAt: t + retryAfterMs,
          retryAfterMs,
        };
      }
      const remainingTokens = refilled - cost;
      await store.setBucket(key, {
        tokens: remainingTokens,
        lastRefillAt: t,
      });
      const msUntilFull = Math.ceil(
        (limits.capacity - remainingTokens) / limits.refillPerMs,
      );
      return {
        allowed: true,
        remaining: Math.floor(remainingTokens),
        limit: limits.capacity,
        resetAt: t + msUntilFull,
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Sliding window (log)                                                       */
/* -------------------------------------------------------------------------- */

function makeSlidingWindowLimiter(
  store: RateLimitStore,
  limits: WindowLimits,
  now: () => number,
): RateLimiter {
  return {
    algorithm: 'slidingWindow',
    async consume(key, cost = 1) {
      if (cost !== 1) {
        // Sliding-window log is a count of timestamps — cost > 1 means
        // we push `cost` timestamps. Most callers use cost = 1.
      }
      const t = now();
      // Prune first so a stale log doesn't reject a fresh request.
      const current = await store.pruneAndCount(key, t, limits.windowMs);
      if (current + cost > limits.limit) {
        return {
          allowed: false,
          remaining: Math.max(0, limits.limit - current),
          limit: limits.limit,
          resetAt: t + limits.windowMs,
          retryAfterMs: limits.windowMs,
        };
      }
      for (let i = 0; i < cost; i++) {
        await store.pushTimestamp(key, t, limits.windowMs);
      }
      return {
        allowed: true,
        remaining: limits.limit - current - cost,
        limit: limits.limit,
        resetAt: t + limits.windowMs,
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Fixed window                                                               */
/* -------------------------------------------------------------------------- */

function makeFixedWindowLimiter(
  store: RateLimitStore,
  limits: WindowLimits,
  now: () => number,
): RateLimiter {
  return {
    algorithm: 'fixedWindow',
    async consume(key, _cost = 1) {
      const t = now();
      const count = await store.incrCounter(key, limits.windowMs, t);
      const allowed = count <= limits.limit;
      const windowEnd = t + limits.windowMs;
      return allowed
        ? {
            allowed: true,
            remaining: limits.limit - count,
            limit: limits.limit,
            resetAt: windowEnd,
          }
        : {
            allowed: false,
            remaining: 0,
            limit: limits.limit,
            resetAt: windowEnd,
            retryAfterMs: limits.windowMs,
          };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Middleware factory                                                         */
/* -------------------------------------------------------------------------- */

export interface RateLimitMiddlewareContext {
  readonly req: {
    readonly path: string;
    readonly method: string;
    header?(name: string): string | undefined;
  };
  readonly res: { readonly headers: { set(k: string, v: string): void } };
  header?(name: string, value: string): void;
  json?(body: unknown, status?: number): unknown;
  status?(code: number): unknown;
}

export interface RateLimitMiddlewareOptions {
  readonly limiter: RateLimiter;
  readonly keyOf: (c: RateLimitMiddlewareContext) => string;
  /** Defaults to 429 + JSON `{ error: 'rate_limited' }` */
  readonly onBlocked?: (
    c: RateLimitMiddlewareContext,
    decision: RateLimitDecision,
  ) => Promise<void> | void;
}

export type RateLimitMiddleware = (
  c: RateLimitMiddlewareContext,
  next: () => Promise<void>,
) => Promise<void>;

export function createRateLimitMiddleware(
  opts: RateLimitMiddlewareOptions,
): RateLimitMiddleware {
  return async function rateLimitMiddleware(c, next) {
    const key = opts.keyOf(c);
    const decision = await opts.limiter.consume(key);

    const setHeader = (name: string, value: string): void => {
      if (c.header) c.header(name, value);
      else c.res.headers.set(name, value);
    };
    setHeader('X-RateLimit-Limit', String(decision.limit));
    setHeader('X-RateLimit-Remaining', String(decision.remaining));
    setHeader('X-RateLimit-Reset', String(decision.resetAt));

    if (!decision.allowed) {
      if (decision.retryAfterMs !== undefined) {
        setHeader(
          'Retry-After',
          String(Math.ceil(decision.retryAfterMs / 1000)),
        );
      }
      if (opts.onBlocked) {
        await opts.onBlocked(c, decision);
      } else if (c.json) {
        if (c.status) c.status(429);
        c.json({ error: 'rate_limited' }, 429);
      }
      return;
    }
    await next();
  };
}

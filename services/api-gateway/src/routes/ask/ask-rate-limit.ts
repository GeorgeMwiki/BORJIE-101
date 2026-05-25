// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union (hono-dev/hono#3891).
/**
 * Per-user, per-endpoint rate limiter scoped to the universal-ask
 * routes. The platform-wide limiter in `middleware/rate-limit.middleware.ts`
 * is role-tiered + tenant-tiered which is the wrong shape here — the
 * spec calls for a flat 10 req/min per (user, endpoint) ceiling.
 *
 * In-memory token-bucket. Multi-instance deployments should swap this
 * for the Redis-backed limiter (composition-root injection point).
 */

import { createMiddleware } from 'hono/factory';

interface BucketState {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, BucketState>();

// Periodic GC so the map doesn't grow unbounded over the process
// lifetime. `.unref()` keeps the interval from holding the event loop
// open in tests.
const GC_INTERVAL_MS = 60_000;
const gcTimer = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}, GC_INTERVAL_MS);
if (typeof gcTimer.unref === 'function') gcTimer.unref();

/**
 * Build the Hono middleware for an `(endpoint, maxPerMinute)` tuple.
 * Each endpoint gets its own bucket key namespace so a burst against
 * `POST /ask` does NOT steal headroom from `GET /ask/starting-points`.
 */
export function askRateLimit(opts: {
  readonly endpoint: string;
  readonly maxPerMinute?: number;
  readonly windowMs?: number;
}) {
  const max = opts.maxPerMinute ?? 10;
  const windowMs = opts.windowMs ?? 60_000;

  return createMiddleware(async (c, next) => {
    const auth = c.get('auth');
    if (!auth?.userId || !auth?.tenantId) {
      // Auth middleware should have already 401'd. If we get here
      // without an auth context, fall through — the route will reject.
      return next();
    }
    const now = Date.now();
    const key = `${auth.tenantId}:${auth.userId}:${opts.endpoint}`;
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(Math.max(0, max - b.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(b.resetAt / 1000)));
    if (b.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
      c.header('Retry-After', String(retryAfterSec));
      return c.json(
        {
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests on this endpoint. Try again shortly.',
            retryAfter: retryAfterSec,
          },
        },
        429,
      );
    }
    return next();
  });
}

/**
 * Test helper — clears the bucket map. Exported so route tests can
 * isolate scenarios without process-recycling.
 */
export function _resetAskRateLimitForTests(): void {
  buckets.clear();
}

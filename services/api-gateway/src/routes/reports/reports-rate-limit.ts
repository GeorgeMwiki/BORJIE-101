/**
 * Per-(user, endpoint) rate limiter for the `/v1/strategic-reports`
 * routes. The platform-wide limiter is tenant-tiered (the right shape
 * for cheap reads) — strategic-report renders are expensive (multi-LLM
 * synthesis + Typst/Carbone compile + WORM signing) so we cap each
 * caller at a flat ceiling no matter the tenant tier.
 *
 * In-memory token-bucket. Multi-instance deployments should swap this
 * for the Redis limiter at the composition root.
 */

import { createMiddleware } from 'hono/factory';

interface BucketState {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, BucketState>();

const GC_INTERVAL_MS = 60_000;
const gcTimer = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}, GC_INTERVAL_MS);
if (typeof gcTimer.unref === 'function') gcTimer.unref();

export function reportsRateLimit(opts: {
  readonly endpoint: string;
  readonly maxPerMinute?: number;
  readonly windowMs?: number;
}) {
  const max = opts.maxPerMinute ?? 5;
  const windowMs = opts.windowMs ?? 60_000;

  return createMiddleware(async (c, next) => {
    const auth = c.get('auth');
    if (!auth?.userId || !auth?.tenantId) {
      // Auth middleware already 401'd. Fall through; the route 401s.
      await next();
      return;
    }
    const key = `${auth.userId}:${opts.endpoint}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      await next();
      return;
    }
    if (bucket.count >= max) {
      const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
      return c.json(
        {
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Rate limit ${max}/min exceeded for ${opts.endpoint}.`,
            retryAfterSec,
          },
        },
        429,
      );
    }
    bucket.count += 1;
    await next();
  });
}

/** Reset for tests — drops every bucket entry. */
export function _resetReportsRateLimitForTests(): void {
  buckets.clear();
}

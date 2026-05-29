/**
 * Redis-backed rate limiter for the Express-level global middleware.
 *
 * Why this exists:
 *   `rate-limit.middleware.ts` uses a process-local `Map`. With HPA
 *   auto-scaling the api-gateway between 3 and 20 replicas, the effective
 *   rate limit becomes `maxRequests * replicas` — a 100/min cap permits
 *   up to 2000/min at peak. Agent DEPLOY flagged this as a HIGH severity
 *   gap because it silently breaks both abuse-prevention and tenant
 *   fairness guarantees in the SLA.
 *
 * Algorithm:
 *   Fixed-window counter keyed by `{tenantId, routeClass, windowStart}`.
 *   One INCR + PEXPIRE pipeline per request is atomic on the Redis
 *   server. When the returned counter exceeds `maxRequests` the request
 *   is rejected with 429. Fixed-window is intentionally simpler than a
 *   sliding window / GCRA — it is well understood, produces predictable
 *   `X-RateLimit-*` headers, and the burst at a window boundary is
 *   acceptable for the traffic volumes this gateway sees.
 *
 * Route classes:
 *   AI-class routes (chat, document upload, voice) get a tighter bucket
 *   because each request costs real LLM tokens and/or seconds of CPU —
 *   a flat 100/min cap would let one abusive tenant burn the monthly
 *   AI budget. Classification is path-prefix based and runs in O(1).
 *
 * Degraded mode:
 *   If `REDIS_URL` is unset OR the Redis client raises at check-time
 *   (network blip, flushed credentials, auth failure), the middleware
 *   falls back to an in-memory limiter so the gateway never hard-fails
 *   a request because the limiter itself is broken. A one-shot warn
 *   line marks the transition so operators see it in the logs.
 */

import type { Request, Response, NextFunction } from 'express';
import type { Redis as IoRedisClient } from 'ioredis';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Route class governs which bucket a request charges against. */
export type RouteClass = 'ai' | 'default';

/** Pluggable classifier so callers (and tests) can override the default. */
export type RouteClassifier = (req: Request) => RouteClass;

/**
 * R41 — per-tenant override.
 *
 * Resolver returns an optional ceiling pair for the request's tenant.
 * NULL fields fall through to the env-driven cluster defaults. Wired
 * synchronously to keep the hot path lock-free; the composition root
 * memoises tenant lookups in-process so the resolver is O(1) on the
 * critical path.
 */
export interface TenantRateLimitOverride {
  readonly default?: number | null;
  readonly ai?: number | null;
}

export type TenantCeilingResolver = (
  req: Request,
) => TenantRateLimitOverride | null | undefined;

export interface RateLimitRedisOptions {
  /** Connected ioredis client. When absent, the middleware degrades to in-memory. */
  readonly redis?: IoRedisClient | null;
  /** Window length in ms. Defaults to RATE_LIMIT_WINDOW_MS env or 60_000. */
  readonly windowMs?: number;
  /** Default bucket ceiling. Defaults to RATE_LIMIT_MAX_REQUESTS or 100. */
  readonly maxRequests?: number;
  /**
   * Tighter ceiling for AI-class routes.
   * Defaults to RATE_LIMIT_AI_MAX or 30 (one tenant ~= 2 req/sec of LLM).
   */
  readonly aiMaxRequests?: number;
  /** Override route classification (defaults to the path-prefix classifier below). */
  readonly routeClassifier?: RouteClassifier;
  /** Override key extraction (defaults to tenantId header or IP). */
  readonly keyGenerator?: (req: Request) => string;
  /**
   * R41 — Per-tenant ceiling resolver. When present, the returned
   * override.default / override.ai supersede the env-driven defaults.
   * NULL fields fall through to the env defaults. NULL / undefined
   * resolver result also falls through (no override applies).
   */
  readonly tenantCeilingResolver?: TenantCeilingResolver;
  /**
   * Optional structured logger — use `logger.warn` when the Redis pipeline
   * raises so operators see the degraded transition exactly once.
   */
  readonly logger?: { warn: (meta: unknown, msg: string) => void };
  /**
   * G5 — robustness 2026-05-29.
   *
   * Optional Sentry hook called on every Redis fallback so on-call
   * pages light up when Redis is down. The hook signature mirrors
   * `@borjie/observability`'s `getSentry().captureException` — pass
   * either that directly or a wrapper that adds extra tags.
   */
  readonly sentryCapture?: (err: unknown, context?: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Default classifier
// ---------------------------------------------------------------------------

/**
 * AI endpoints: anything under /api/v1/ai/*, plus /documents/upload
 * and /voice. The prefix list is small on purpose — everything else
 * falls through to the default bucket.
 */
const AI_PATH_PATTERNS: ReadonlyArray<RegExp> = [
  /\/api\/v1\/ai(\/|$)/,
  /\/api\/v1\/ai-native(\/|$)/,
  /\/api\/v1\/ai-chat(\/|$)/,
  /\/api\/v1\/doc-chat(\/|$)/,
  /\/api\/v1\/voice(\/|$)/,
  /\/api\/v1\/brain(\/|$)/,
  /\/api\/v1\/documents\/upload$/,
];

export const defaultRouteClassifier: RouteClassifier = (req) => {
  const path = req.path || req.url || '';
  for (const re of AI_PATH_PATTERNS) {
    if (re.test(path)) return 'ai';
  }
  return 'default';
};

// ---------------------------------------------------------------------------
// Default key generator — tenantId header wins, falls back to IP.
// ---------------------------------------------------------------------------

function defaultKeyGenerator(req: Request): string {
  const tenantHeader = req.headers['x-tenant-id'];
  const tenantId =
    typeof tenantHeader === 'string'
      ? tenantHeader
      : Array.isArray(tenantHeader)
        ? tenantHeader[0]
        : undefined;
  if (tenantId && tenantId.length > 0) return `tenant:${tenantId}`;
  const fwd = req.headers['x-forwarded-for'];
  const fwdFirst =
    typeof fwd === 'string' ? fwd.split(',')[0]?.trim() : undefined;
  const ip = req.ip || fwdFirst || 'unknown';
  return `ip:${ip}`;
}

// ---------------------------------------------------------------------------
// In-memory fallback — only used when Redis is unavailable.
// ---------------------------------------------------------------------------

interface InMemoryEntry {
  count: number;
  resetAt: number;
}

const inMemoryStore = new Map<string, InMemoryEntry>();
const CLEANUP_INTERVAL_MS = 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of inMemoryStore) {
    if (now > entry.resetAt) inMemoryStore.delete(key);
  }
}, CLEANUP_INTERVAL_MS).unref();

function checkInMemory(
  key: string,
  windowMs: number,
  max: number,
  now: number,
): { count: number; resetAt: number; allowed: boolean } {
  let entry = inMemoryStore.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    inMemoryStore.set(key, entry);
  }
  entry.count++;
  return {
    count: entry.count,
    resetAt: entry.resetAt,
    allowed: entry.count <= max,
  };
}

// ---------------------------------------------------------------------------
// Redis backend — INCR + PEXPIRE pipelined so the counter + TTL are atomic.
// ---------------------------------------------------------------------------

interface RedisCheckResult {
  count: number;
  resetAt: number;
}

async function checkRedis(
  redis: IoRedisClient,
  fullKey: string,
  windowMs: number,
  windowStartMs: number,
): Promise<RedisCheckResult> {
  // ioredis pipeline: [['INCR', key], ['PEXPIRE', key, ttl]]. The PEXPIRE
  // must cover the whole window plus a 1s safety margin so the key is
  // guaranteed to outlive the window even if the Redis clock drifts.
  const ttl = windowMs + 1_000;
  const pipeline = redis.pipeline();
  pipeline.incr(fullKey);
  pipeline.pexpire(fullKey, ttl);
  const results = await pipeline.exec();
  if (!results || results.length === 0) {
    throw new Error('rate-limit: empty pipeline result from redis');
  }
  const [incrErr, incrRes] = results[0] ?? [];
  if (incrErr) throw incrErr instanceof Error ? incrErr : new Error(String(incrErr));
  const count = typeof incrRes === 'number' ? incrRes : Number(incrRes);
  if (!Number.isFinite(count)) {
    throw new Error(`rate-limit: unexpected INCR result ${String(incrRes)}`);
  }
  return { count, resetAt: windowStartMs + windowMs };
}

// ---------------------------------------------------------------------------
// Factory — produces an Express middleware.
// ---------------------------------------------------------------------------

/**
 * G5 — process-level status flag for the rate-limit Redis client.
 *
 * Flipped to `'down'` the moment the Redis pipeline raises and back to
 * `'up'` the next time it succeeds. Exposed via `getRateLimitRedisStatus`
 * so the deep-health probe can flag the degraded mode on /health/deep
 * without each gateway replica having to talk to Redis again.
 *
 * `firstFallbackAt` / `lastFallbackAt` give operators a "since when"
 * timeline; `fallbackCount` is the monotonic counter that the alerting
 * rule fires on (e.g. >0 in a 1-min window).
 */
interface RateLimitRedisStatus {
  status: 'up' | 'down' | 'unknown';
  firstFallbackAt: string | null;
  lastFallbackAt: string | null;
  fallbackCount: number;
  lastError: string | null;
}

const sharedRedisStatus: RateLimitRedisStatus = {
  status: 'unknown',
  firstFallbackAt: null,
  lastFallbackAt: null,
  fallbackCount: 0,
  lastError: null,
};

export function getRateLimitRedisStatus(): Readonly<RateLimitRedisStatus> {
  return { ...sharedRedisStatus };
}

/** Test-only: reset the shared status between tests. */
export function __resetRateLimitRedisStatus(): void {
  sharedRedisStatus.status = 'unknown';
  sharedRedisStatus.firstFallbackAt = null;
  sharedRedisStatus.lastFallbackAt = null;
  sharedRedisStatus.fallbackCount = 0;
  sharedRedisStatus.lastError = null;
}

export function createRateLimitMiddleware(options: RateLimitRedisOptions = {}) {
  const windowMs = options.windowMs ?? parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
  const maxRequests =
    options.maxRequests ?? parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10);
  const aiMax =
    options.aiMaxRequests ?? parseInt(process.env.RATE_LIMIT_AI_MAX || '30', 10);
  const classifier = options.routeClassifier ?? defaultRouteClassifier;
  const keyGen = options.keyGenerator ?? defaultKeyGenerator;
  const redis = options.redis ?? null;
  const logger = options.logger;
  const sentryCapture = options.sentryCapture;
  const tenantCeilingResolver = options.tenantCeilingResolver;

  // G5 — robustness 2026-05-29.
  //
  // Each fallback now:
  //   1. Bumps the shared `sharedRedisStatus` counter so /health/deep
  //      can flag the degraded mode cluster-wide.
  //   2. Emits a Pino `warn` on EVERY fallback (was: once per process).
  //      A one-shot warn missed sustained outages; on-call needs the
  //      ongoing signal.
  //   3. Captures to Sentry on every fallback so alerting rules fire.
  //      The hook is no-op when not wired.
  const degrade = (err: unknown) => {
    const nowIso = new Date().toISOString();
    sharedRedisStatus.status = 'down';
    sharedRedisStatus.lastFallbackAt = nowIso;
    if (sharedRedisStatus.firstFallbackAt === null) {
      sharedRedisStatus.firstFallbackAt = nowIso;
    }
    sharedRedisStatus.fallbackCount += 1;
    sharedRedisStatus.lastError = err instanceof Error ? err.message : String(err);
    logger?.warn(
      {
        err: sharedRedisStatus.lastError,
        fallbackCount: sharedRedisStatus.fallbackCount,
        firstFallbackAt: sharedRedisStatus.firstFallbackAt,
      },
      'rate-limit: redis unavailable — falling back to in-memory limiter',
    );
    try {
      sentryCapture?.(err, {
        scope: 'rate-limit',
        fallbackCount: sharedRedisStatus.fallbackCount,
      });
    } catch {
      // Sentry hook bugs must never break the request pipeline.
    }
  };
  // Mark Redis healthy after every successful pipeline call so the
  // deep-health flag clears once the network recovers.
  const recover = () => {
    if (sharedRedisStatus.status !== 'up') {
      sharedRedisStatus.status = 'up';
    }
  };

  return async function rateLimitRedisMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const routeClass = classifier(req);
    // R41 — per-tenant override resolution. NULL / undefined falls
    // through to the env-driven defaults.
    const override = tenantCeilingResolver?.(req) ?? null;
    const defaultCeiling = override?.default ?? maxRequests;
    const aiCeiling = override?.ai ?? aiMax;
    const ceiling = routeClass === 'ai' ? aiCeiling : defaultCeiling;
    const keyBase = keyGen(req);
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const fullKey = `rl:${keyBase}:${routeClass}:${windowStart}`;

    let count: number;
    let resetAt: number;

    if (redis) {
      try {
        const r = await checkRedis(redis, fullKey, windowMs, windowStart);
        count = r.count;
        resetAt = r.resetAt;
        recover();
      } catch (err) {
        degrade(err);
        const r = checkInMemory(fullKey, windowMs, ceiling, now);
        count = r.count;
        resetAt = r.resetAt;
      }
    } else {
      const r = checkInMemory(fullKey, windowMs, ceiling, now);
      count = r.count;
      resetAt = r.resetAt;
    }

    const remaining = Math.max(0, ceiling - count);
    res.setHeader('X-RateLimit-Limit', ceiling);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000));
    res.setHeader('X-RateLimit-Class', routeClass);

    if (count > ceiling) {
      const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
      res.setHeader('Retry-After', retryAfter);
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
          routeClass,
          retryAfter,
        },
      });
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Test-only helper: reset the in-memory store between tests so state from
// one test does not leak into another. Never called from production code.
// ---------------------------------------------------------------------------

export function __resetInMemoryStore(): void {
  inMemoryStore.clear();
}

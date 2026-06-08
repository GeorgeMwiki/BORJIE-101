/**
 * Rate Limiting Middleware - BORJIE
 * 
 * Implements:
 * - Token bucket algorithm for smooth rate limiting
 * - Multiple rate limit tiers (by role, endpoint, tenant)
 * - Redis-compatible in-memory store
 * - Request validation and sanitization
 * - IP-based and API key-based limiting
 */

import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { randomUUID } from 'node:crypto';
import type { UserRole } from '../types/user-role';
import type { AuthContext } from './hono-auth';
import { createLogger } from '../utils/logger';
import {
  RedisTokenBucket,
  createRedisTokenBucket,
  type EvalCapableRedis,
  type TokenBucketDecision,
} from './redis-token-bucket';

// ============================================================================
// Types
// ============================================================================

export interface RateLimitConfig {
  /** Maximum requests per window */
  maxRequests: number;
  /** Window size in seconds */
  windowSizeSeconds: number;
  /** Optional burst allowance */
  burstSize?: number;
  /** Skip successful requests (for login attempts, etc.) */
  skipSuccessful?: boolean;
  /** Custom key generator */
  keyGenerator?: (c: Context) => string;
}

export interface RateLimitTier {
  name: string;
  config: RateLimitConfig;
  roles?: UserRole[];
  endpoints?: string[];
  methods?: string[];
}

export interface RateLimitState {
  tokens: number;
  lastRefill: number;
  requestCount: number;
  windowStart: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  reset: number;
  retryAfter?: number;
}

// ============================================================================
// Configuration
// ============================================================================

// Default rate limits by role
const roleLimits: Record<UserRole | 'anonymous', RateLimitConfig> = {
  SUPER_ADMIN: { maxRequests: 10000, windowSizeSeconds: 60 },
  ADMIN: { maxRequests: 5000, windowSizeSeconds: 60 },
  SUPPORT: { maxRequests: 2000, windowSizeSeconds: 60 },
  TENANT_ADMIN: { maxRequests: 2000, windowSizeSeconds: 60 },
  PROPERTY_MANAGER: { maxRequests: 1000, windowSizeSeconds: 60 },
  ACCOUNTANT: { maxRequests: 500, windowSizeSeconds: 60 },
  MAINTENANCE_STAFF: { maxRequests: 500, windowSizeSeconds: 60 },
  OWNER: { maxRequests: 300, windowSizeSeconds: 60 },
  RESIDENT: { maxRequests: 200, windowSizeSeconds: 60 },
  anonymous: { maxRequests: 100, windowSizeSeconds: 60 },
};

// Endpoint-specific rate limits
const endpointLimits: Record<string, RateLimitConfig> = {
  // Auth endpoints - stricter limits
  'POST:/auth/login': { maxRequests: 10, windowSizeSeconds: 60, skipSuccessful: false },
  'POST:/auth/register': { maxRequests: 5, windowSizeSeconds: 300 },
  'POST:/auth/forgot-password': { maxRequests: 3, windowSizeSeconds: 300 },
  'POST:/auth/mfa/verify': { maxRequests: 5, windowSizeSeconds: 60 },
  
  // Webhook endpoints - high volume
  'POST:/webhooks/*': { maxRequests: 10000, windowSizeSeconds: 60 },
  
  // Report generation - expensive
  'POST:/reports/generate': { maxRequests: 10, windowSizeSeconds: 60 },
  'GET:/reports/audit-pack/*': { maxRequests: 5, windowSizeSeconds: 60 },
  
  // Notification sending - controlled
  'POST:/notifications/send': { maxRequests: 100, windowSizeSeconds: 60 },
  'POST:/notifications/broadcast': { maxRequests: 5, windowSizeSeconds: 300 },
  
  // Payment operations - sensitive
  'POST:/payments': { maxRequests: 50, windowSizeSeconds: 60 },
  'POST:/payments/*/refund': { maxRequests: 10, windowSizeSeconds: 60 },
  
  // File uploads
  'POST:/documents/upload': { maxRequests: 20, windowSizeSeconds: 60 },
};

// ============================================================================
// In-Memory Store (Replace with Redis in production)
// ============================================================================

class RateLimitStore {
  private store = new Map<string, RateLimitState>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  get(key: string): RateLimitState | undefined {
    return this.store.get(key);
  }

  set(key: string, state: RateLimitState): void {
    this.store.set(key, state);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    const maxAge = 600000; // 10 minutes

    for (const [key, state] of this.store) {
      if (now - state.windowStart > maxAge) {
        this.store.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

const rateLimitStore = new RateLimitStore();

// ============================================================================
// Rate Limiter Implementation
// ============================================================================

class TokenBucketRateLimiter {
  /**
   * Check if request is allowed using token bucket algorithm
   */
  check(key: string, config: RateLimitConfig): RateLimitResult {
    const now = Date.now();
    const windowMs = config.windowSizeSeconds * 1000;
    const refillRate = config.maxRequests / config.windowSizeSeconds; // tokens per second
    
    let state = rateLimitStore.get(key);
    
    if (!state) {
      // Initialize new bucket
      state = {
        tokens: config.maxRequests,
        lastRefill: now,
        requestCount: 0,
        windowStart: now,
      };
    } else {
      // Refill tokens based on time elapsed
      const timeSinceLastRefill = (now - state.lastRefill) / 1000;
      const tokensToAdd = timeSinceLastRefill * refillRate;
      
      state.tokens = Math.min(
        config.maxRequests + (config.burstSize || 0),
        state.tokens + tokensToAdd
      );
      state.lastRefill = now;
      
      // Reset window if expired
      if (now - state.windowStart > windowMs) {
        state.requestCount = 0;
        state.windowStart = now;
      }
    }
    
    // Check if we have tokens available
    if (state.tokens < 1) {
      const timeToRefill = (1 - state.tokens) / refillRate;
      rateLimitStore.set(key, state);
      
      return {
        allowed: false,
        remaining: 0,
        reset: Math.ceil(state.windowStart + windowMs),
        retryAfter: Math.ceil(timeToRefill),
      };
    }
    
    // Consume a token
    state.tokens -= 1;
    state.requestCount += 1;
    rateLimitStore.set(key, state);
    
    return {
      allowed: true,
      remaining: Math.floor(state.tokens),
      reset: Math.ceil(state.windowStart + windowMs),
    };
  }

  /**
   * Restore a token (for successful requests when skipSuccessful is true)
   */
  restore(key: string): void {
    const state = rateLimitStore.get(key);
    if (state) {
      state.tokens += 1;
      rateLimitStore.set(key, state);
    }
  }

  /**
   * Block an IP temporarily (for security incidents)
   */
  block(key: string, durationSeconds: number): void {
    const state: RateLimitState = {
      tokens: -durationSeconds, // Negative tokens = blocked
      lastRefill: Date.now(),
      requestCount: 0,
      windowStart: Date.now(),
    };
    rateLimitStore.set(key, state);
  }

  /**
   * Check if an IP/key is blocked
   */
  isBlocked(key: string): boolean {
    const state = rateLimitStore.get(key);
    return state !== undefined && state.tokens < 0;
  }
}

const rateLimiter = new TokenBucketRateLimiter();

// ============================================================================
// RSS-08 — distributed token bucket (cross-replica cap)
// ============================================================================

/**
 * GATE: presence of `process.env.REDIS_URL`.
 *
 * When `REDIS_URL` is set, `perUserRateLimit` / `customRateLimit` charge a
 * shared Redis token bucket so the cap is exact cluster-wide. When it is
 * UNSET (local dev / tests) — or when the Redis call throws at request time —
 * they fall back to the existing in-process `TokenBucketRateLimiter`, i.e. the
 * exact behaviour that ships today. This module reads `REDIS_URL` ONCE here at
 * load time (the established `per-tenant-rate-budget.ts` / `cross-portal-bus.ts`
 * pattern), never per request.
 */

const rlLogger = createLogger('rate-limiter');

let sharedTokenBucket: RedisTokenBucket | null = null;
let bucketInitDone = false;
// One-shot degrade marker so a sustained Redis outage logs once, not per
// request — mirrors the signal posture in `rate-limit-redis.middleware.ts`.
let loggedBucketDegrade = false;

/**
 * Optional Sentry capture hook so on-call pages light up when the distributed
 * bucket falls back to in-process. Wired from the composition root via
 * `initRedisTokenBucket`; no-op until then.
 */
let bucketSentryCapture:
  | ((err: unknown, ctx?: Record<string, unknown>) => void)
  | null = null;

export interface InitRedisTokenBucketOptions {
  /**
   * Pre-constructed eval-capable redis client. When omitted, this function
   * lazily constructs an ioredis client from `process.env.REDIS_URL` (only if
   * that env var is set). Injecting a client keeps tests hermetic and lets the
   * composition root share ONE client.
   */
  readonly redis?: EvalCapableRedis | null;
  /** Sentry capture for fallback events. Mirrors rate-limit-redis.middleware. */
  readonly sentryCapture?: (err: unknown, ctx?: Record<string, unknown>) => void;
}

/**
 * Bootstrap wiring for the distributed limiter. Call ONCE from the composition
 * root / bootstrap. Idempotent — repeated calls after the first are ignored so
 * a double-wire never opens a second redis connection.
 *
 * Returns the active bucket (or `null` when `REDIS_URL` is unset and no client
 * was injected — i.e. the in-process fallback is in force).
 */
export function initRedisTokenBucket(
  options: InitRedisTokenBucketOptions = {},
): RedisTokenBucket | null {
  if (bucketInitDone) return sharedTokenBucket;
  bucketInitDone = true;

  if (options.sentryCapture) bucketSentryCapture = options.sentryCapture;

  // Explicit injected client (composition root / tests) wins.
  if (options.redis) {
    sharedTokenBucket = createRedisTokenBucket(options.redis);
    rlLogger.info('rate-limiter: distributed token bucket wired (injected redis)');
    return sharedTokenBucket;
  }

  // GATE: no REDIS_URL → stay on the in-process limiter (today's behaviour).
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    rlLogger.info('rate-limiter: REDIS_URL unset — using in-process token bucket (dev mode)');
    return null;
  }

  try {
    // Lazy-require ioredis — the ESM/CJS export shape varies across bundlers;
    // mirror the constructor resolution used in index.ts / cross-portal-bus.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ioredisMod = require('ioredis');
    const RedisCtor = ioredisMod?.default ?? ioredisMod?.Redis ?? ioredisMod;
    const client = new RedisCtor(redisUrl, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    client.on?.('error', (err: Error) => {
      rlLogger.warn(
        { err: err.message },
        'rate-limiter: redis client error (token bucket will fall back to in-process)',
      );
    });
    sharedTokenBucket = createRedisTokenBucket(client as EvalCapableRedis);
    rlLogger.info('rate-limiter: distributed token bucket wired (REDIS_URL)');
    return sharedTokenBucket;
  } catch (err) {
    rlLogger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'rate-limiter: failed to construct redis token bucket — using in-process limiter',
    );
    sharedTokenBucket = null;
    return null;
  }
}

/**
 * Lazily resolve the shared bucket on first use even if `initRedisTokenBucket`
 * was never called explicitly — so a route mounted before bootstrap still gets
 * the gated behaviour. Reads `REDIS_URL` exactly once via `initRedisTokenBucket`.
 */
function resolveTokenBucket(): RedisTokenBucket | null {
  if (!bucketInitDone) initRedisTokenBucket();
  return sharedTokenBucket;
}

/** Emit the one-shot degrade signal (Pino warn + optional Sentry). */
function signalBucketDegrade(err: unknown): void {
  if (!loggedBucketDegrade) {
    loggedBucketDegrade = true;
    rlLogger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'rate-limiter: redis token bucket unavailable — falling back to in-process limiter',
    );
  }
  try {
    bucketSentryCapture?.(err, { scope: 'rate-limiter-token-bucket' });
  } catch {
    // Sentry hook bugs must never break the request pipeline.
  }
}

/**
 * Charge one token for `key` under `config`, using the distributed Redis bucket
 * when wired and falling back to the in-process limiter on absence OR failure.
 * The returned shape matches `RateLimitResult` so callers are agnostic to which
 * backend served the decision.
 */
async function chargeToken(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const bucket = resolveTokenBucket();
  if (bucket) {
    try {
      const capacity = config.maxRequests + (config.burstSize ?? 0);
      const refillRatePerSec = config.maxRequests / config.windowSizeSeconds;
      const decision: TokenBucketDecision = await bucket.consume(key, {
        capacity,
        refillRatePerSec,
      });
      return {
        allowed: decision.allowed,
        remaining: decision.remaining,
        reset: Math.ceil(Date.now() + config.windowSizeSeconds * 1000),
        // exactOptionalPropertyTypes: omit the optional key entirely when
        // allowed rather than assigning `undefined`.
        ...(decision.allowed ? {} : { retryAfter: decision.retryAfter }),
      };
    } catch (err) {
      signalBucketDegrade(err);
      // fall through to in-process limiter
    }
  }
  // In-process fallback (REDIS_URL unset, or Redis blip) — today's behaviour.
  return rateLimiter.check(key, config);
}

/** Test-only — reset the distributed-bucket wiring between tests. */
export function __resetRedisTokenBucketForTests(): void {
  sharedTokenBucket = null;
  bucketInitDone = false;
  loggedBucketDegrade = false;
  bucketSentryCapture = null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get client IP from request
 */
function getClientIP(c: Context): string {
  // Check common headers for proxied requests
  const forwarded = c.req.header('X-Forwarded-For');
  if (forwarded) {
    const first = forwarded.split(',')[0];
    if (first) return first.trim();
  }
  
  const realIP = c.req.header('X-Real-IP');
  if (realIP) {
    return realIP;
  }
  
  // Fallback to remote address
  return c.req.header('CF-Connecting-IP') || 'unknown';
}

/**
 * Generate rate limit key
 */
function generateKey(c: Context, config: RateLimitConfig): string {
  if (config.keyGenerator) {
    return config.keyGenerator(c);
  }
  
  const auth = c.get('auth') as AuthContext | undefined;
  const ip = getClientIP(c);
  
  if (auth) {
    // Authenticated: key by user + tenant
    return `rate:${auth.tenantId}:${auth.userId}`;
  }
  
  // Unauthenticated: key by IP
  return `rate:ip:${ip}`;
}

/**
 * Get rate limit config for request
 */
function getConfigForRequest(c: Context): RateLimitConfig {
  const method = c.req.method;
  const path = c.req.path;
  const auth = c.get('auth') as AuthContext | undefined;
  
  // Check endpoint-specific limits first
  const endpointKey = `${method}:${path}`;
  for (const [pattern, config] of Object.entries(endpointLimits)) {
    if (matchesPattern(endpointKey, pattern)) {
      return config;
    }
  }
  
  // Fall back to role-based limits
  const role = auth?.role || 'anonymous';
  return roleLimits[role] || roleLimits.anonymous;
}

/**
 * Match endpoint pattern (supports * wildcard)
 */
function matchesPattern(path: string, pattern: string): boolean {
  if (pattern === path) return true;
  
  const patternParts = pattern.split('/');
  const pathParts = path.split(':')[1]?.split('/') || path.split('/');
  
  if (patternParts.length !== pathParts.length && !pattern.includes('*')) {
    return false;
  }
  
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i];
    if (part === '*') return true;
    if (part !== pathParts[i] && !(part?.startsWith(':') ?? false)) {
      return false;
    }
  }
  
  return true;
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Rate limiting middleware
 */
export const rateLimitMiddleware = createMiddleware(async (c, next) => {
  const config = getConfigForRequest(c);
  const key = generateKey(c, config);
  
  // Check if blocked
  if (rateLimiter.isBlocked(key)) {
    return c.json({
      success: false,
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Access temporarily blocked due to excessive requests',
      },
    }, 429);
  }
  
  // Check rate limit
  const result = rateLimiter.check(key, config);
  
  // Set rate limit headers
  c.header('X-RateLimit-Limit', String(config.maxRequests));
  c.header('X-RateLimit-Remaining', String(result.remaining));
  c.header('X-RateLimit-Reset', String(result.reset));
  
  if (!result.allowed) {
    c.header('Retry-After', String(result.retryAfter || 60));
    
    return c.json({
      success: false,
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: result.retryAfter,
      },
    }, 429);
  }
  
  await next();
  
  // Restore token if skipSuccessful and request was successful
  if (config.skipSuccessful) {
    const status = c.res.status;
    if (status >= 200 && status < 300) {
      rateLimiter.restore(key);
    }
  }
});

/**
 * Per-user rate-limit factory — windowMs + max, scoped to the
 * authenticated `userId` (falls back to IP for anonymous callers).
 * Delegates to `customRateLimit`, so when `REDIS_URL` is set the cap is
 * enforced across all replicas via the shared Redis token bucket (RSS-08);
 * otherwise it uses the in-process token-bucket store, cohabiting with the
 * other limiters.
 *
 * Used by the declared-facts router to cap producer churn at 30 calls
 * per minute per user (A2b-3 wire #5).
 */
export const perUserRateLimit = (opts: {
  readonly windowMs: number;
  readonly max: number;
}) => {
  const config: RateLimitConfig = {
    maxRequests: opts.max,
    windowSizeSeconds: Math.max(1, Math.floor(opts.windowMs / 1000)),
    keyGenerator: (c) => {
      const auth = c.get('auth') as AuthContext | undefined;
      if (auth) return `perUser:${auth.tenantId}:${auth.userId}`;
      return `perUser:ip:${getClientIP(c)}`;
    },
  };
  return customRateLimit(config);
};

/**
 * Custom rate limiter for specific endpoints.
 *
 * RSS-08: charges the shared Redis token bucket when `REDIS_URL` is set so the
 * cap is exact across all replicas; falls back to the in-process limiter when
 * unset or when Redis is unreachable. `perUserRateLimit` delegates here, so it
 * inherits the same distributed behaviour for free.
 */
export const customRateLimit = (config: RateLimitConfig) => {
  return createMiddleware(async (c, next) => {
    const key = generateKey(c, config);

    const result = await chargeToken(key, config);

    c.header('X-RateLimit-Limit', String(config.maxRequests));
    c.header('X-RateLimit-Remaining', String(result.remaining));
    c.header('X-RateLimit-Reset', String(result.reset));
    
    if (!result.allowed) {
      c.header('Retry-After', String(result.retryAfter || 60));
      
      return c.json({
        success: false,
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Rate limit exceeded',
          retryAfter: result.retryAfter,
        },
      }, 429);
    }
    
    await next();
  });
};

/**
 * IP blocking middleware (for security incidents)
 */
export const ipBlockMiddleware = createMiddleware(async (c, next) => {
  const ip = getClientIP(c);
  const blockKey = `block:ip:${ip}`;
  
  if (rateLimiter.isBlocked(blockKey)) {
    return c.json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Access denied',
      },
    }, 403);
  }
  
  await next();
});

/**
 * Block an IP address
 */
export function blockIP(ip: string, durationSeconds: number = 3600): void {
  rateLimiter.block(`block:ip:${ip}`, durationSeconds);
}

/**
 * Login attempt rate limiter (tracks failed attempts)
 */
export const loginRateLimiter = createMiddleware(async (c, next) => {
  const ip = getClientIP(c);
  const key = `login:${ip}`;
  
  const config: RateLimitConfig = {
    maxRequests: 10,
    windowSizeSeconds: 900, // 15 minutes
    skipSuccessful: true,
  };
  
  const result = rateLimiter.check(key, config);
  
  if (!result.allowed) {
    // Block IP after too many failed attempts
    if (result.remaining <= 0) {
      blockIP(ip, 900); // Block for 15 minutes
    }
    
    return c.json({
      success: false,
      error: {
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Too many login attempts. Please try again later.',
        retryAfter: result.retryAfter,
      },
    }, 429);
  }
  
  await next();
  
  // Restore token on successful login
  const status = c.res.status;
  if (status >= 200 && status < 300) {
    rateLimiter.restore(key);
  }
});

// ============================================================================
// Request Validation Middleware
// ============================================================================

/**
 * Request size limiter
 */
export const requestSizeLimiter = (maxSizeBytes: number = 1024 * 1024) => {
  return createMiddleware(async (c, next) => {
    const contentLength = c.req.header('Content-Length');
    
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (size > maxSizeBytes) {
        return c.json({
          success: false,
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: `Request body exceeds maximum size of ${maxSizeBytes} bytes`,
          },
        }, 413);
      }
    }
    
    await next();
  });
};

/**
 * Content type validator
 */
export const contentTypeValidator = (...allowedTypes: string[]) => {
  return createMiddleware(async (c, next) => {
    const contentType = c.req.header('Content-Type');
    
    if (!contentType) {
      if (c.req.method !== 'GET' && c.req.method !== 'DELETE') {
        return c.json({
          success: false,
          error: {
            code: 'MISSING_CONTENT_TYPE',
            message: 'Content-Type header is required',
          },
        }, 400);
      }
    } else {
      const type = (contentType.split(';')[0] ?? '').trim();
      const isAllowed = allowedTypes.some(allowed =>
        type === allowed || type.startsWith(allowed)
      );
      
      if (!isAllowed) {
        return c.json({
          success: false,
          error: {
            code: 'UNSUPPORTED_MEDIA_TYPE',
            message: `Content-Type '${type}' is not supported. Allowed types: ${allowedTypes.join(', ')}`,
          },
        }, 415);
      }
    }
    
    await next();
  });
};

/**
 * Request sanitization middleware
 */
export const sanitizeRequest = createMiddleware(async (c, next) => {
  // Check for common attack patterns in query params
  const url = new URL(c.req.url);
  const params = url.searchParams;
  
  const dangerousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+=/i,
    /\.\.\//,
    /\0/,
    /%00/,
    /%3Cscript/i,
  ];
  
  for (const [key, value] of params) {
    for (const pattern of dangerousPatterns) {
      if (pattern.test(key) || pattern.test(value)) {
        return c.json({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Request contains potentially harmful content',
          },
        }, 400);
      }
    }
  }
  
  await next();
});

/**
 * CORS middleware
 */
export const corsMiddleware = (options: {
  origins: string[];
  methods?: string[];
  headers?: string[];
  credentials?: boolean;
  maxAge?: number;
}) => {
  // `origins` is required (no default) — a wildcard default combined
  // with credentials=true below would enable CSRF. Callers must pass an
  // explicit allowlist; production CORS is handled at the Express layer
  // in services/api-gateway/src/index.ts, so this helper is reserved for
  // isolated sub-apps that want their own policy.
  if (!options.origins || options.origins.length === 0) {
    throw new Error('corsMiddleware: options.origins allowlist is required');
  }
  const {
    origins,
    methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    headers = ['Content-Type', 'Authorization', 'X-Request-ID'],
    credentials = true,
    maxAge = 86400,
  } = options;
  
  return createMiddleware(async (c, next) => {
    const origin = c.req.header('Origin');
    
    // Check if origin is allowed
    const allowedOrigin = origins.includes('*') 
      ? '*' 
      : origins.find(o => o === origin) || '';
    
    // Set CORS headers
    c.header('Access-Control-Allow-Origin', allowedOrigin);
    c.header('Access-Control-Allow-Methods', methods.join(', '));
    c.header('Access-Control-Allow-Headers', headers.join(', '));
    c.header('Access-Control-Max-Age', String(maxAge));
    
    if (credentials && allowedOrigin !== '*') {
      c.header('Access-Control-Allow-Credentials', 'true');
    }
    
    // Handle preflight requests
    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }
    
    await next();
  });
};

/**
 * Request ID middleware
 */
export const requestIdMiddleware = createMiddleware(async (c, next) => {
  let requestId = c.req.header('X-Request-ID');

  if (!requestId) {
    // crypto.randomUUID is a CSPRNG-backed v4 UUID — safe for correlation
    // IDs that may appear in logs, rate-limit buckets, and traces.
    requestId = `req_${randomUUID()}`;
  }

  c.header('X-Request-ID', requestId);
  c.set('requestId', requestId);
  
  await next();
});

// Extend Hono context types
declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
  }
}

export { rateLimiter, rateLimitStore };

/**
 * Per-tenant token-budget middleware (Hono).
 *
 * Fixed-window Redis-backed token counter, keyed
 * `rate-budget:${tenantId}:${windowStart}`. INCRBY + EXPIRE-on-first-touch
 * runs as a single Lua EVAL (atomic across replicas) with a MULTI/EXEC
 * fallback for managed-Redis tiers that block scripting.
 *
 * Redis-down behaviour:
 *   - production: returns 503 RATE_LIMITER_UNAVAILABLE. Never silently
 *     falls back — that would let an attacker bypass the cap by
 *     knocking Redis over.
 *   - dev / test: WARN once, fall back to in-memory.
 *
 * Circuit breaker: after `breakerThreshold` consecutive Redis errors the
 * breaker opens for `breakerCooldownMs`; Redis is short-circuited
 * (skip the call, go straight to the degraded path) until cooldown
 * elapses and the next request probes again. A successful call closes
 * the breaker.
 *
 * Cost estimate: ceil(content-length / 4) tokens, or
 * `defaultEstimateTokens` when the header is missing.
 *
 * Apply only to Jarvis kernel routes; the auth middleware must run
 * first so `tenantId` is present on the context.
 */

import type { MiddlewareHandler } from 'hono';
import type { Redis as IoRedisClient } from 'ioredis';
import { recordTenantBudgetExceeded } from '../observability/metrics.js';
import { createLogger } from '../utils/logger.js';

const CHARS_PER_TOKEN = 4;
const DEFAULT_HOURLY_BUDGET = 1_000_000;
const DEFAULT_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_ESTIMATE_TOKENS = 256;
const DEFAULT_BREAKER_THRESHOLD = 5;
const DEFAULT_BREAKER_COOLDOWN_MS = 30_000;
const KEY_PREFIX = 'rate-budget';

const moduleLogger = createLogger('per-tenant-rate-budget');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BudgetLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Allowed `surface` values for the Prometheus label (DA2 fix).
 *
 * Constrained at the factory boundary so a future caller wiring a
 * path-derived or user-derived string cannot explode the metric's
 * cardinality — every unique label value materialises a separate
 * time-series in Prometheus and is permanent once scraped.
 *
 * Add new members here ONLY after confirming the call site is bounded
 * (i.e. a hand-written literal, not a request-derived string).
 *
 *   - `api`         — generic HTTP API routes
 *   - `webhook`     — inbound webhook surfaces
 *   - `admin`       — platform-admin / tenant-admin surfaces
 *   - `brain`       — Brain / Jarvis-kernel routes
 *   - `realtime`    — SSE / WebSocket surfaces
 *   - `background`  — workers + cron drainers
 *   - `jarvis`      — current default in this file (compatibility)
 *   - `tenant-app`  — tenant-facing app router (voice-agent-wiring,
 *                     jarvis-router-factory, metrics fixtures)
 */
export const RATE_BUDGET_SURFACES = Object.freeze([
  'api',
  'webhook',
  'admin',
  'brain',
  'realtime',
  'background',
  'jarvis',
  'tenant-app',
] as const);

export type RateBudgetSurface = (typeof RATE_BUDGET_SURFACES)[number];

export function isRateBudgetSurface(value: unknown): value is RateBudgetSurface {
  return (
    typeof value === 'string' &&
    (RATE_BUDGET_SURFACES as ReadonlyArray<string>).includes(value)
  );
}

export interface PerTenantRateBudgetOptions {
  readonly hourlyTokenBudget?: number;
  readonly windowMs?: number;
  readonly defaultEstimateTokens?: number;
  readonly clock?: () => number;
  readonly surface?: RateBudgetSurface;
  readonly tenantIdExtractor?: (c: BudgetCtx) => string | null;
  readonly redis?: IoRedisClient | null;
  readonly nodeEnv?: string;
  readonly logger?: BudgetLogger;
  readonly breakerThreshold?: number;
  readonly breakerCooldownMs?: number;
}

export interface BudgetCtx {
  req: { header(name: string): string | undefined };
  get(key: 'auth' | string): unknown;
  set(key: string, value: unknown): void;
  header(name: string, value: string): void;
  json(body: unknown, status?: number): unknown;
}

export interface PerTenantRateBudgetMiddleware {
  readonly handler: MiddlewareHandler;
  readonly limits: { readonly hourlyTokenBudget: number; readonly windowMs: number };
  remaining(tenantId: string): Promise<number>;
  readonly breakerState: () => 'closed' | 'open';
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function defaultTenantIdExtractor(c: BudgetCtx): string | null {
  const auth = c.get('auth') as { tenantId?: string | null } | undefined;
  return auth?.tenantId ?? null;
}

function estimateTokensFromHeaders(c: BudgetCtx, fallback: number): number {
  const len = c.req.header('content-length');
  if (!len) return fallback;
  const n = Number.parseInt(len, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.ceil(n / CHARS_PER_TOKEN);
}

function readEnvBudget(): number {
  const raw = process.env.TENANT_HOURLY_TOKEN_BUDGET?.trim();
  if (!raw) return DEFAULT_HOURLY_BUDGET;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_HOURLY_BUDGET;
  return n;
}

function windowKey(tenantId: string, windowStart: number): string {
  return `${KEY_PREFIX}:${tenantId}:${windowStart}`;
}

function windowStartFor(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * windowMs;
}

function retryAfterSeconds(windowStart: number, windowMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((windowStart + windowMs - nowMs) / 1000));
}

// ---------------------------------------------------------------------------
// Redis backend — single Lua round-trip, MULTI fallback for no-EVAL tiers.
// ---------------------------------------------------------------------------

// DA1 MEDIUM finding: previously `EXPIRE` was gated on `v == cost`, i.e.
// only the first-touch caller set the TTL. Under concurrent first-touch
// across replicas with different `cost` values, two concurrent INCRBYs
// can race so neither sees `v == cost` from its own perspective — the
// key then never expires and silently leaks. EXPIRE is idempotent and
// cheap; always call it after INCRBY. Same fix in the MULTI/EXEC
// fallback path below.
const INCREMENT_LUA = `
local k = KEYS[1]
local cost = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local v = redis.call('INCRBY', k, cost)
redis.call('EXPIRE', k, ttl)
return v
`;

async function runRedisIncrement(
  redis: IoRedisClient,
  key: string,
  cost: number,
  ttlSec: number,
): Promise<number> {
  const evalFn = (redis as unknown as {
    eval?: (s: string, n: number, ...a: Array<string | number>) => Promise<unknown>;
  }).eval;
  if (typeof evalFn === 'function') {
    const result = await evalFn.call(redis, INCREMENT_LUA, 1, key, cost, ttlSec);
    const n = typeof result === 'number' ? result : Number(result);
    if (!Number.isFinite(n)) {
      throw new Error(`rate-budget: unexpected EVAL result ${String(result)}`);
    }
    return n;
  }
  const pipeline = redis.multi();
  pipeline.incrby(key, cost);
  const results = await pipeline.exec();
  if (!results || results.length === 0) {
    throw new Error('rate-budget: empty multi result from redis');
  }
  const [incrErr, incrRes] = results[0] ?? [];
  if (incrErr) throw incrErr instanceof Error ? incrErr : new Error(String(incrErr));
  const total = typeof incrRes === 'number' ? incrRes : Number(incrRes);
  if (!Number.isFinite(total)) {
    throw new Error(`rate-budget: unexpected INCRBY result ${String(incrRes)}`);
  }
  // DA1 MEDIUM finding: always EXPIRE (don't gate on first-touch).
  // EXPIRE is idempotent and cheap; the previous gated form let a
  // concurrent first-touch race leak the key permanently when neither
  // caller observed `total === cost` from its own perspective. Two
  // round-trips total (INCRBY then EXPIRE) — acceptable on the no-EVAL
  // fallback tier; the Lua path keeps the single-round-trip property.
  await redis.expire(key, ttlSec);
  return total;
}

// ---------------------------------------------------------------------------
// In-memory fallback (dev/test only) — immutable bucket updates.
// ---------------------------------------------------------------------------

interface InMemoryBucket {
  readonly windowStart: number;
  readonly total: number;
}

function incrementInMemory(
  store: Map<string, InMemoryBucket>,
  tenantId: string,
  windowStart: number,
  cost: number,
): number {
  const existing = store.get(tenantId);
  if (!existing || existing.windowStart !== windowStart) {
    store.set(tenantId, { windowStart, total: cost });
    return cost;
  }
  const next: InMemoryBucket = { windowStart, total: existing.total + cost };
  store.set(tenantId, next);
  return next.total;
}

function peekInMemory(
  store: Map<string, InMemoryBucket>,
  tenantId: string,
  windowStart: number,
): number {
  const existing = store.get(tenantId);
  if (!existing || existing.windowStart !== windowStart) return 0;
  return existing.total;
}

// ---------------------------------------------------------------------------
// Circuit breaker — pure state transitions, closure-scoped state.
// ---------------------------------------------------------------------------

interface BreakerState {
  failures: number;
  openedAt: number | null;
}

function isBreakerOpen(state: BreakerState, now: number, cooldownMs: number): boolean {
  if (state.openedAt === null) return false;
  return now - state.openedAt < cooldownMs;
}

function recordBreakerSuccess(state: BreakerState): BreakerState {
  if (state.failures === 0 && state.openedAt === null) return state;
  return { failures: 0, openedAt: null };
}

function recordBreakerFailure(
  state: BreakerState,
  now: number,
  threshold: number,
): BreakerState {
  const failures = state.failures + 1;
  if (failures >= threshold) return { failures, openedAt: now };
  return { failures, openedAt: state.openedAt };
}

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

function buildUnavailableResponse(c: BudgetCtx): Response {
  // `BudgetCtx.json` returns `unknown` so Hono's `MiddlewareHandler` boundary
  // is decoupled from the Response type. Cast at the call site rather than
  // widening the interface — the runtime value IS a Response.
  return c.json(
    {
      success: false,
      error: {
        code: 'RATE_LIMITER_UNAVAILABLE',
        message: 'Rate limiter backing store is unreachable',
      },
    },
    503,
  ) as Response;
}

function buildExceededResponse(
  c: BudgetCtx,
  cap: number,
  total: number,
  windowStart: number,
  windowMs: number,
  now: number,
): Response {
  const retryAfter = retryAfterSeconds(windowStart, windowMs, now);
  c.header('Retry-After', String(retryAfter));
  c.header('X-RateLimit-Limit', String(cap));
  c.header('X-RateLimit-Remaining', String(Math.max(0, cap - total)));
  return c.json(
    {
      success: false,
      error: {
        code: 'TENANT_TOKEN_BUDGET_EXCEEDED',
        message: `Tenant has exceeded its hourly token budget (${cap}).`,
        retryAfter,
      },
    },
    429,
  ) as Response;
}

function emitOkHeaders(c: BudgetCtx, cap: number, total: number): void {
  c.header('X-RateLimit-Limit', String(cap));
  c.header('X-RateLimit-Remaining', String(Math.max(0, cap - total)));
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

interface InternalState {
  breaker: BreakerState;
  inMemory: Map<string, InMemoryBucket>;
  loggedDegradation: boolean;
}

export function createPerTenantRateBudgetMiddleware(
  options: PerTenantRateBudgetOptions = {},
): PerTenantRateBudgetMiddleware {
  const hourlyTokenBudget = options.hourlyTokenBudget ?? readEnvBudget();
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const fallbackEstimate = options.defaultEstimateTokens ?? DEFAULT_ESTIMATE_TOKENS;
  const clock = options.clock ?? Date.now;
  // DA2 cleanup: reject unknown `surface` values at factory time. The
  // surface label feeds Prometheus; a request-derived string would blow
  // cardinality permanently. Reject early with a clear actionable error
  // so the misuse fails at boot, not in production at scrape time.
  const surfaceRaw: unknown = options.surface ?? 'jarvis';
  if (!isRateBudgetSurface(surfaceRaw)) {
    throw new TypeError(
      `per-tenant-rate-budget: invalid surface "${String(surfaceRaw)}". ` +
        `Must be one of: ${RATE_BUDGET_SURFACES.join(', ')}. ` +
        `Add new members to RATE_BUDGET_SURFACES only after confirming the call site uses a literal (not a request-derived string).`,
    );
  }
  const surface: RateBudgetSurface = surfaceRaw;
  const tenantIdExtractor = options.tenantIdExtractor ?? defaultTenantIdExtractor;
  const redis = options.redis ?? null;
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';
  const log = options.logger ?? moduleLogger;
  const breakerThreshold = options.breakerThreshold ?? DEFAULT_BREAKER_THRESHOLD;
  const breakerCooldownMs = options.breakerCooldownMs ?? DEFAULT_BREAKER_COOLDOWN_MS;
  const ttlSec = Math.floor(windowMs / 1000) + 5;

  const state: InternalState = {
    breaker: { failures: 0, openedAt: null },
    inMemory: new Map(),
    loggedDegradation: false,
  };

  function recordMetric(): void {
    try {
      recordTenantBudgetExceeded({ surface });
    } catch {
      // metrics must never break a request
    }
  }

  function emitDegradationWarn(reason: string, err?: unknown): void {
    if (state.loggedDegradation) return;
    state.loggedDegradation = true;
    log.warn('rate-budget: redis unavailable — degraded fallback active', {
      reason,
      err: err instanceof Error ? err.message : err ? String(err) : undefined,
      env: nodeEnv,
    });
  }

  async function incrementWithRedis(
    tenantId: string,
    windowStart: number,
    cost: number,
    now: number,
  ): Promise<{ ok: true; total: number } | { ok: false }> {
    if (!redis) return { ok: false };
    if (isBreakerOpen(state.breaker, now, breakerCooldownMs)) return { ok: false };
    try {
      const total = await runRedisIncrement(redis, windowKey(tenantId, windowStart), cost, ttlSec);
      state.breaker = recordBreakerSuccess(state.breaker);
      return { ok: true, total };
    } catch (err) {
      state.breaker = recordBreakerFailure(state.breaker, now, breakerThreshold);
      log.error('rate-budget: redis increment failed', {
        err: err instanceof Error ? err.message : String(err),
        tenantId,
        breakerFailures: state.breaker.failures,
        breakerOpen: state.breaker.openedAt !== null,
      });
      return { ok: false };
    }
  }

  const handler: MiddlewareHandler = async (c, next) => {
    const now = clock();
    const ctx = c as unknown as BudgetCtx;
    const tenantId = tenantIdExtractor(ctx);
    if (!tenantId) {
      // Upstream auth decides whether unauthenticated paths are allowed.
      await next();
      return;
    }

    const windowStart = windowStartFor(now, windowMs);
    const cost = estimateTokensFromHeaders(ctx, fallbackEstimate);
    const result = await incrementWithRedis(tenantId, windowStart, cost, now);

    if (result.ok) {
      if (result.total > hourlyTokenBudget) {
        recordMetric();
        return buildExceededResponse(ctx, hourlyTokenBudget, result.total, windowStart, windowMs, now);
      }
      emitOkHeaders(ctx, hourlyTokenBudget, result.total);
      await next();
      return;
    }

    if (isProd) {
      emitDegradationWarn('redis-unreachable-prod-503');
      return buildUnavailableResponse(ctx);
    }

    emitDegradationWarn('redis-unreachable-dev-fallback');
    const total = incrementInMemory(state.inMemory, tenantId, windowStart, cost);
    if (total > hourlyTokenBudget) {
      recordMetric();
      return buildExceededResponse(ctx, hourlyTokenBudget, total, windowStart, windowMs, now);
    }
    emitOkHeaders(ctx, hourlyTokenBudget, total);
    await next();
  };

  return {
    handler,
    limits: { hourlyTokenBudget, windowMs },
    async remaining(tenantId: string): Promise<number> {
      const now = clock();
      const windowStart = windowStartFor(now, windowMs);
      if (redis && !isBreakerOpen(state.breaker, now, breakerCooldownMs)) {
        try {
          const raw = await redis.get(windowKey(tenantId, windowStart));
          const total = raw === null ? 0 : Number.parseInt(raw, 10);
          if (Number.isFinite(total)) return Math.max(0, hourlyTokenBudget - total);
        } catch (err) {
          log.warn('rate-budget: remaining() redis lookup failed', {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const total = peekInMemory(state.inMemory, tenantId, windowStart);
      return Math.max(0, hourlyTokenBudget - total);
    },
    breakerState(): 'closed' | 'open' {
      return state.breaker.openedAt === null ? 'closed' : 'open';
    },
  };
}

// ---------------------------------------------------------------------------
// Shared-instance helpers — used by the gateway composition root.
// ---------------------------------------------------------------------------

let sharedInstance: PerTenantRateBudgetMiddleware | null = null;

/**
 * First call wires the cached singleton (with optional Redis client +
 * logger from the composition root); later calls return that cached
 * instance and ignore their options argument.
 */
export function getSharedPerTenantRateBudget(
  options?: PerTenantRateBudgetOptions,
): PerTenantRateBudgetMiddleware {
  if (!sharedInstance) {
    sharedInstance = createPerTenantRateBudgetMiddleware(options);
  }
  return sharedInstance;
}

export function __resetSharedPerTenantRateBudgetForTests(): void {
  sharedInstance = null;
}

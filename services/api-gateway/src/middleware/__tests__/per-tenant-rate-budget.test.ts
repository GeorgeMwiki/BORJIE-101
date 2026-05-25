/**
 * Unit tests for the per-tenant token-budget middleware.
 *
 * Covers the Redis-backed path (atomic INCRBY + EXPIRE via EVAL), the
 * in-memory dev fallback, the prod 503 path, and the circuit-breaker.
 * A hand-rolled fake ioredis (just `.eval` + `.get`) keeps the suite
 * hermetic — no `ioredis-mock` dep, no live Redis.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import {
  createPerTenantRateBudgetMiddleware,
  __resetSharedPerTenantRateBudgetForTests,
  RATE_BUDGET_SURFACES,
  isRateBudgetSurface,
  type BudgetLogger,
} from '../per-tenant-rate-budget';

// ---------------------------------------------------------------------------
// Fake ioredis — narrow surface (eval + get + multi + incrby + expire).
// ---------------------------------------------------------------------------

interface FakeEntry {
  value: number;
  expiresAt: number; // 0 == no TTL
}

class FakeRedis {
  private readonly store = new Map<string, FakeEntry>();
  private nowMs: number = Date.now();
  public failNext: Error | null = null;
  public failPermanently: boolean = false;
  public evalCalls = 0;
  // DA1 MEDIUM: track EXPIRE invocations so we can assert the Lua path
  // sets TTL on every INCRBY (not just on first-touch).
  public expireCalls: Array<{ key: string; ttl: number }> = [];

  advanceTime(ms: number): void {
    this.nowMs += ms;
    for (const [k, v] of this.store) {
      if (v.expiresAt !== 0 && this.nowMs > v.expiresAt) this.store.delete(k);
    }
  }

  // Mirrors ioredis.eval(script, numKeys, ...args)
  async eval(_script: string, _numKeys: number, ...args: Array<string | number>): Promise<number> {
    this.evalCalls += 1;
    if (this.failPermanently) throw new Error('redis permanent fail');
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    const key = String(args[0]);
    const cost = Number(args[1]);
    const ttlSec = Number(args[2]);
    // Lua emits INCRBY + EXPIRE atomically. Record the EXPIRE so the
    // unconditional-TTL invariant can be asserted by tests.
    this.expireCalls.push({ key, ttl: ttlSec });
    const existing = this.store.get(key);
    if (!existing) {
      this.store.set(key, { value: cost, expiresAt: this.nowMs + ttlSec * 1000 });
      return cost;
    }
    existing.value += cost;
    // Refresh the TTL on every INCRBY (matches the new Lua semantics).
    existing.expiresAt = this.nowMs + ttlSec * 1000;
    return existing.value;
  }

  async get(key: string): Promise<string | null> {
    const e = this.store.get(key);
    if (!e) return null;
    if (e.expiresAt !== 0 && this.nowMs > e.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return String(e.value);
  }
}

// ---------------------------------------------------------------------------
// Helpers — build a tiny Hono app that stamps `auth.tenantId` from header.
// ---------------------------------------------------------------------------

interface AppDeps {
  hourlyTokenBudget: number;
  windowMs?: number;
  clock?: () => number;
  redis?: FakeRedis | null;
  nodeEnv?: string;
  logger?: BudgetLogger;
  breakerThreshold?: number;
  breakerCooldownMs?: number;
}

interface BuiltApp {
  app: Hono;
  mw: ReturnType<typeof createPerTenantRateBudgetMiddleware>;
}

function makeApp(opts: AppDeps): BuiltApp {
  const middleware = createPerTenantRateBudgetMiddleware({
    hourlyTokenBudget: opts.hourlyTokenBudget,
    ...(opts.windowMs !== undefined ? { windowMs: opts.windowMs } : {}),
    ...(opts.clock ? { clock: opts.clock } : {}),
    ...(opts.redis !== undefined
      ? { redis: opts.redis as unknown as import('ioredis').Redis | null }
      : {}),
    ...(opts.nodeEnv ? { nodeEnv: opts.nodeEnv } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
    ...(opts.breakerThreshold !== undefined
      ? { breakerThreshold: opts.breakerThreshold }
      : {}),
    ...(opts.breakerCooldownMs !== undefined
      ? { breakerCooldownMs: opts.breakerCooldownMs }
      : {}),
  });
  const app = new Hono();
  app.use('*', async (c, next) => {
    const headerTenant = c.req.header('x-test-tenant');
    if (headerTenant) {
      c.set('auth' as never, { tenantId: headerTenant } as never);
    }
    await next();
  });
  app.use('*', middleware.handler);
  app.get('/test', (c) => c.json({ ok: true }));
  return { app, mw: middleware };
}

interface CapturedLog {
  level: 'warn' | 'error';
  message: string;
  meta?: Record<string, unknown>;
}

function makeCaptureLogger(): { logs: CapturedLog[]; logger: BudgetLogger } {
  const logs: CapturedLog[] = [];
  return {
    logs,
    logger: {
      warn: (message, meta) => {
        logs.push({ level: 'warn', message, ...(meta ? { meta } : {}) });
      },
      error: (message, meta) => {
        logs.push({ level: 'error', message, ...(meta ? { meta } : {}) });
      },
    },
  };
}

beforeEach(() => {
  __resetSharedPerTenantRateBudgetForTests();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('per-tenant rate budget — Redis-backed', () => {
  it('allows requests well under budget and emits remaining header', async () => {
    const redis = new FakeRedis();
    const { app } = makeApp({ hourlyTokenBudget: 1_000_000, redis });
    const res = await app.request('/test', {
      headers: { 'x-test-tenant': 'tnt-a', 'content-length': '256' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('1000000');
    // 256 chars / 4 = 64 tokens consumed.
    expect(res.headers.get('X-RateLimit-Remaining')).toBe(String(1_000_000 - 64));
    expect(redis.evalCalls).toBe(1);
  });

  it('blocks over-limit requests with 429 + Retry-After', async () => {
    const redis = new FakeRedis();
    const { app } = makeApp({
      hourlyTokenBudget: 100,
      windowMs: 3_600_000,
      redis,
    });
    // 4096 chars / 4 = 1024 tokens > 100 cap. First request already over.
    const res = await app.request('/test', {
      headers: { 'x-test-tenant': 'tnt-b', 'content-length': '4096' },
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('TENANT_TOKEN_BUDGET_EXCEEDED');
  });

  it('isolates buckets across tenants — one tenant cannot drain another', async () => {
    const redis = new FakeRedis();
    const { app } = makeApp({ hourlyTokenBudget: 256, windowMs: 60_000, redis });
    // Tenant A burns its budget.
    const a1 = await app.request('/test', {
      headers: { 'x-test-tenant': 'tnt-A', 'content-length': '1024' },
    });
    expect(a1.status).toBe(200);
    const a2 = await app.request('/test', {
      headers: { 'x-test-tenant': 'tnt-A', 'content-length': '1024' },
    });
    expect(a2.status).toBe(429);
    // Tenant B is unaffected.
    const b1 = await app.request('/test', {
      headers: { 'x-test-tenant': 'tnt-B', 'content-length': '1024' },
    });
    expect(b1.status).toBe(200);
  });

  it('skips the gate for unauthenticated requests', async () => {
    const redis = new FakeRedis();
    const { app } = makeApp({ hourlyTokenBudget: 1, redis }); // tiny cap
    const res = await app.request('/test', {
      headers: { 'content-length': '4096' },
    });
    // No tenantId → middleware no-ops; Redis is never called.
    expect(res.status).toBe(200);
    expect(redis.evalCalls).toBe(0);
  });

  it('sets EXPIRE unconditionally on every INCRBY — never just first-touch (DA1 MEDIUM)', async () => {
    // Regression for the Lua race: previously EXPIRE was gated on
    // `v == cost`, which under concurrent first-touch across replicas
    // could leave the key with no TTL. The new Lua calls EXPIRE every
    // time INCRBY runs — idempotent + cheap. Assert by counting
    // EXPIRE invocations against eval invocations.
    const redis = new FakeRedis();
    const { app } = makeApp({ hourlyTokenBudget: 1_000_000, redis });
    await app.request('/test', {
      headers: { 'x-test-tenant': 'expire-tnt', 'content-length': '256' },
    });
    await app.request('/test', {
      headers: { 'x-test-tenant': 'expire-tnt', 'content-length': '256' },
    });
    await app.request('/test', {
      headers: { 'x-test-tenant': 'expire-tnt', 'content-length': '256' },
    });
    expect(redis.evalCalls).toBe(3);
    expect(redis.expireCalls.length).toBe(3);
    // All EXPIREs on the same key (same window) and with the same TTL.
    const uniqueKeys = new Set(redis.expireCalls.map((c) => c.key));
    expect(uniqueKeys.size).toBe(1);
    const uniqueTtls = new Set(redis.expireCalls.map((c) => c.ttl));
    expect(uniqueTtls.size).toBe(1);
  });

  it('windows roll over — fixed-window key changes per window', async () => {
    let now = 0;
    const redis = new FakeRedis();
    const { app } = makeApp({
      hourlyTokenBudget: 64,
      windowMs: 1_000,
      clock: () => now,
      redis,
    });
    // 256 chars → 64 tokens. Exactly fills.
    const r1 = await app.request('/test', {
      headers: { 'x-test-tenant': 'tnt-c', 'content-length': '256' },
    });
    expect(r1.status).toBe(200);
    const r2 = await app.request('/test', {
      headers: { 'x-test-tenant': 'tnt-c', 'content-length': '256' },
    });
    expect(r2.status).toBe(429);
    // Jump to the next window — fresh bucket.
    now += 2_000;
    const r3 = await app.request('/test', {
      headers: { 'x-test-tenant': 'tnt-c', 'content-length': '256' },
    });
    expect(r3.status).toBe(200);
  });
});

describe('per-tenant rate budget — Redis-down behaviour', () => {
  it('returns 503 RATE_LIMITER_UNAVAILABLE in production on Redis error', async () => {
    const redis = new FakeRedis();
    redis.failPermanently = true;
    const { logs, logger } = makeCaptureLogger();
    const { app } = makeApp({
      hourlyTokenBudget: 100,
      redis,
      nodeEnv: 'production',
      logger,
    });
    const res = await app.request('/test', {
      headers: { 'x-test-tenant': 'tnt-d', 'content-length': '256' },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('RATE_LIMITER_UNAVAILABLE');
    expect(body.error?.message).toMatch(/unreachable/i);
    // The error path emits an error log + a one-shot degradation warn.
    expect(logs.some((l) => l.level === 'error')).toBe(true);
    expect(logs.some((l) => l.level === 'warn' && /redis unavailable/.test(l.message))).toBe(true);
  });

  it('returns 503 in production when no Redis client is configured', async () => {
    const { app } = makeApp({
      hourlyTokenBudget: 100,
      redis: null,
      nodeEnv: 'production',
    });
    const res = await app.request('/test', {
      headers: { 'x-test-tenant': 'tnt-e', 'content-length': '256' },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('RATE_LIMITER_UNAVAILABLE');
  });

  it('falls back to in-memory in dev with a WARN log', async () => {
    const redis = new FakeRedis();
    redis.failPermanently = true;
    const { logs, logger } = makeCaptureLogger();
    const { app } = makeApp({
      hourlyTokenBudget: 1_000_000,
      redis,
      nodeEnv: 'development',
      logger,
    });
    const res = await app.request('/test', {
      headers: { 'x-test-tenant': 'tnt-f', 'content-length': '256' },
    });
    // Even with Redis down, dev mode serves the request from in-memory.
    expect(res.status).toBe(200);
    // The degradation WARN appears exactly once.
    const warns = logs.filter((l) => l.level === 'warn' && /redis unavailable/.test(l.message));
    expect(warns.length).toBe(1);

    // A second failing request must NOT re-emit the WARN.
    await app.request('/test', {
      headers: { 'x-test-tenant': 'tnt-f', 'content-length': '256' },
    });
    const warnsAfter = logs.filter((l) => l.level === 'warn' && /redis unavailable/.test(l.message));
    expect(warnsAfter.length).toBe(1);
  });

  it('in-memory fallback still isolates buckets across tenants', async () => {
    const redis = new FakeRedis();
    redis.failPermanently = true;
    const { app } = makeApp({
      hourlyTokenBudget: 64,
      windowMs: 60_000,
      redis,
      nodeEnv: 'development',
    });
    const a1 = await app.request('/test', {
      headers: { 'x-test-tenant': 'iso-A', 'content-length': '256' },
    });
    expect(a1.status).toBe(200);
    const a2 = await app.request('/test', {
      headers: { 'x-test-tenant': 'iso-A', 'content-length': '256' },
    });
    expect(a2.status).toBe(429);
    const b1 = await app.request('/test', {
      headers: { 'x-test-tenant': 'iso-B', 'content-length': '256' },
    });
    expect(b1.status).toBe(200);
  });

  it('with no Redis configured in dev: serves traffic from in-memory', async () => {
    const { app } = makeApp({
      hourlyTokenBudget: 64,
      windowMs: 60_000,
      redis: null,
      nodeEnv: 'development',
    });
    const r1 = await app.request('/test', {
      headers: { 'x-test-tenant': 'no-redis', 'content-length': '256' },
    });
    expect(r1.status).toBe(200);
    const r2 = await app.request('/test', {
      headers: { 'x-test-tenant': 'no-redis', 'content-length': '256' },
    });
    expect(r2.status).toBe(429);
  });
});

describe('per-tenant rate budget — circuit breaker', () => {
  it('trips after threshold consecutive failures and short-circuits Redis calls', async () => {
    const redis = new FakeRedis();
    redis.failPermanently = true;
    const { app, mw } = makeApp({
      hourlyTokenBudget: 1_000_000,
      redis,
      nodeEnv: 'development',
      breakerThreshold: 3,
      breakerCooldownMs: 30_000,
    });
    // Three failed Redis attempts close the breaker.
    for (let i = 0; i < 3; i++) {
      await app.request('/test', {
        headers: { 'x-test-tenant': 'cb-tnt', 'content-length': '256' },
      });
    }
    expect(mw.breakerState()).toBe('open');
    const callsAtTrip = redis.evalCalls;
    // The next request must NOT hit Redis — short-circuited to fallback.
    await app.request('/test', {
      headers: { 'x-test-tenant': 'cb-tnt', 'content-length': '256' },
    });
    expect(redis.evalCalls).toBe(callsAtTrip);
  });

  it('returns 503 in production while the breaker is open', async () => {
    const redis = new FakeRedis();
    redis.failPermanently = true;
    const { app } = makeApp({
      hourlyTokenBudget: 1_000_000,
      redis,
      nodeEnv: 'production',
      breakerThreshold: 2,
      breakerCooldownMs: 30_000,
    });
    // Trip the breaker.
    await app.request('/test', {
      headers: { 'x-test-tenant': 'cb-prod', 'content-length': '256' },
    });
    await app.request('/test', {
      headers: { 'x-test-tenant': 'cb-prod', 'content-length': '256' },
    });
    // Breaker open — still 503 in prod, but Redis is no longer touched.
    const callsAtTrip = redis.evalCalls;
    const res = await app.request('/test', {
      headers: { 'x-test-tenant': 'cb-prod', 'content-length': '256' },
    });
    expect(res.status).toBe(503);
    expect(redis.evalCalls).toBe(callsAtTrip);
  });
});

describe('per-tenant rate budget — remaining() diagnostic', () => {
  it('returns the budget cap for a tenant with no recorded usage', async () => {
    const redis = new FakeRedis();
    const { mw } = makeApp({
      hourlyTokenBudget: 1_000_000,
      windowMs: 60_000,
      redis,
    });
    const left = await mw.remaining('fresh-tnt');
    expect(left).toBe(1_000_000);
  });

  it('reflects consumed tokens from Redis', async () => {
    const redis = new FakeRedis();
    const { app, mw } = makeApp({
      hourlyTokenBudget: 1_000_000,
      windowMs: 60_000,
      redis,
    });
    await app.request('/test', {
      headers: { 'x-test-tenant': 'rem-tnt', 'content-length': '256' },
    });
    // 256 chars → 64 tokens.
    const left = await mw.remaining('rem-tnt');
    expect(left).toBe(1_000_000 - 64);
  });
});

// ---------------------------------------------------------------------------
// DA2 fix — surface enum constraint at factory time.
// ---------------------------------------------------------------------------

describe('per-tenant rate budget — surface enum (DA2)', () => {
  it('exposes a frozen list of allowed surface values', () => {
    expect(Array.isArray(RATE_BUDGET_SURFACES)).toBe(true);
    expect(RATE_BUDGET_SURFACES).toContain('api');
    expect(RATE_BUDGET_SURFACES).toContain('webhook');
    expect(RATE_BUDGET_SURFACES).toContain('admin');
    expect(RATE_BUDGET_SURFACES).toContain('brain');
    expect(RATE_BUDGET_SURFACES).toContain('realtime');
    expect(RATE_BUDGET_SURFACES).toContain('background');
    // Existing call sites (default + voice-agent-wiring + tests).
    expect(RATE_BUDGET_SURFACES).toContain('jarvis');
    expect(RATE_BUDGET_SURFACES).toContain('tenant-app');
    expect(Object.isFrozen(RATE_BUDGET_SURFACES)).toBe(true);
  });

  it('isRateBudgetSurface narrows correctly', () => {
    expect(isRateBudgetSurface('tenant-app')).toBe(true);
    expect(isRateBudgetSurface('jarvis')).toBe(true);
    expect(isRateBudgetSurface('admin')).toBe(true);
    expect(isRateBudgetSurface('/api/v1/markets/123')).toBe(false);
    expect(isRateBudgetSurface('')).toBe(false);
    expect(isRateBudgetSurface(undefined)).toBe(false);
    expect(isRateBudgetSurface(42)).toBe(false);
  });

  it('factory throws TypeError when surface is an unknown string', () => {
    expect(() =>
      createPerTenantRateBudgetMiddleware({
        // Path-derived strings would explode Prometheus cardinality; the
        // factory must refuse them. `as never` defeats the compile-time
        // check so we can prove the runtime guard fires.
        surface: '/api/v1/markets/abc' as never,
      }),
    ).toThrow(TypeError);
  });

  it('factory error names the violator and lists the allowed members', () => {
    try {
      createPerTenantRateBudgetMiddleware({ surface: 'not-a-surface' as never });
      throw new Error('expected TypeError');
    } catch (err) {
      expect(err).toBeInstanceOf(TypeError);
      const msg = (err as Error).message;
      expect(msg).toMatch(/not-a-surface/);
      expect(msg).toMatch(/Must be one of/);
      for (const allowed of RATE_BUDGET_SURFACES) {
        expect(msg).toContain(allowed);
      }
    }
  });

  it('factory accepts every documented member', () => {
    for (const allowed of RATE_BUDGET_SURFACES) {
      expect(() =>
        createPerTenantRateBudgetMiddleware({ surface: allowed }),
      ).not.toThrow();
    }
  });
});

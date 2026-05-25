/**
 * Real-shaped Redis integration tests for the per-tenant rate-budget
 * middleware. The companion `per-tenant-rate-budget.test.ts` uses a
 * one-method `FakeRedis` (eval + get). DA4 finding: that does NOT
 * exercise:
 *   - the MULTI/EXEC fallback path triggered on managed-Redis tiers
 *     that block scripting (`runRedisIncrement` falls through to
 *     `redis.multi().incrby(...).exec()` when `redis.eval` is absent).
 *   - the standalone `redis.expire()` call inside that fallback.
 *   - `redis.get()` for the `remaining()` diagnostic when the breaker
 *     is closed.
 *
 * This file ships an `ioredis`-shaped fake (`pipeline`, `expire`,
 * proper `[err, result]` exec tuples) so divergence between the
 * Lua-EVAL path and the MULTI/EXEC path surfaces in CI. Without a
 * runtime Redis (which the suite would need a container for) this is
 * the closest reproduction we can hold the contract against.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import {
  createPerTenantRateBudgetMiddleware,
  __resetSharedPerTenantRateBudgetForTests,
  type BudgetLogger,
} from '../per-tenant-rate-budget';

// ---------------------------------------------------------------------------
// ioredis-shaped fake — pipeline + expire + eval/no-eval modes.
// ---------------------------------------------------------------------------

interface FakeEntry {
  value: number;
  expiresAtMs: number;
}

interface PipelineOp {
  readonly kind: 'incrby' | 'expire';
  readonly key: string;
  readonly arg: number;
}

class IoredisShapedFake {
  private readonly store = new Map<string, FakeEntry>();
  private nowMs: number = Date.now();
  public readonly evalDisabled: boolean;
  public failPermanently: boolean = false;
  public evalCalls = 0;
  public incrbyCalls = 0;
  public expireCalls = 0;
  public getCalls = 0;

  constructor(opts: { evalDisabled?: boolean } = {}) {
    this.evalDisabled = opts.evalDisabled ?? false;
    if (opts.evalDisabled) {
      // ioredis surfaces eval as a method on the prototype. The
      // middleware probes `typeof redis.eval === 'function'`; we
      // deliberately leave eval undefined on this fake to force the
      // MULTI/EXEC fallback path.
      Object.defineProperty(this, 'eval', { value: undefined });
    }
  }

  advanceTime(ms: number): void {
    this.nowMs += ms;
    for (const [k, v] of this.store) {
      if (v.expiresAtMs !== 0 && this.nowMs > v.expiresAtMs) this.store.delete(k);
    }
  }

  async eval(
    _script: string,
    _numKeys: number,
    ...args: Array<string | number>
  ): Promise<number> {
    this.evalCalls += 1;
    if (this.failPermanently) throw new Error('redis permanent fail');
    const key = String(args[0]);
    const cost = Number(args[1]);
    const ttlSec = Number(args[2]);
    const existing = this.store.get(key);
    if (!existing) {
      this.store.set(key, {
        value: cost,
        expiresAtMs: this.nowMs + ttlSec * 1000,
      });
      return cost;
    }
    existing.value += cost;
    return existing.value;
  }

  multi(): IoredisShapedPipeline {
    return new IoredisShapedPipeline(this);
  }

  async expire(key: string, ttlSec: number): Promise<number> {
    this.expireCalls += 1;
    if (this.failPermanently) throw new Error('redis permanent fail');
    const e = this.store.get(key);
    if (!e) return 0;
    e.expiresAtMs = this.nowMs + ttlSec * 1000;
    return 1;
  }

  async get(key: string): Promise<string | null> {
    this.getCalls += 1;
    if (this.failPermanently) throw new Error('redis permanent fail');
    const e = this.store.get(key);
    if (!e) return null;
    if (e.expiresAtMs !== 0 && this.nowMs > e.expiresAtMs) {
      this.store.delete(key);
      return null;
    }
    return String(e.value);
  }

  // exposed for the pipeline implementation
  _incrbyImpl(key: string, by: number): number {
    this.incrbyCalls += 1;
    if (this.failPermanently) throw new Error('redis permanent fail');
    const existing = this.store.get(key);
    if (!existing) {
      this.store.set(key, { value: by, expiresAtMs: 0 });
      return by;
    }
    existing.value += by;
    return existing.value;
  }
}

class IoredisShapedPipeline {
  private readonly ops: PipelineOp[] = [];
  constructor(private readonly redis: IoredisShapedFake) {}

  incrby(key: string, by: number): this {
    this.ops.push({ kind: 'incrby', key, arg: by });
    return this;
  }

  expire(key: string, ttl: number): this {
    this.ops.push({ kind: 'expire', key, arg: ttl });
    return this;
  }

  // ioredis exec returns Array<[err, result]> per queued op.
  async exec(): Promise<Array<[Error | null, unknown]>> {
    if (this.redis.failPermanently) {
      // Real ioredis would reject the exec promise on connection failure.
      throw new Error('redis permanent fail');
    }
    return this.ops.map((op) => {
      try {
        if (op.kind === 'incrby') {
          return [null, this.redis._incrbyImpl(op.key, op.arg)];
        }
        // expire from the pipeline
        const e = (this.redis as unknown as { store: Map<string, FakeEntry> }).store.get(op.key);
        if (e) e.expiresAtMs = Date.now() + op.arg * 1000;
        return [null, 1];
      } catch (err) {
        return [err instanceof Error ? err : new Error(String(err)), null];
      }
    });
  }
}

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

interface BuiltApp {
  app: Hono;
  mw: ReturnType<typeof createPerTenantRateBudgetMiddleware>;
}

function makeApp(opts: {
  hourlyTokenBudget: number;
  windowMs?: number;
  redis: IoredisShapedFake;
  nodeEnv?: string;
  logger?: BudgetLogger;
  breakerThreshold?: number;
  breakerCooldownMs?: number;
}): BuiltApp {
  const middleware = createPerTenantRateBudgetMiddleware({
    hourlyTokenBudget: opts.hourlyTokenBudget,
    ...(opts.windowMs !== undefined ? { windowMs: opts.windowMs } : {}),
    redis: opts.redis as unknown as import('ioredis').Redis,
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
    const t = c.req.header('x-test-tenant');
    if (t) c.set('auth' as never, { tenantId: t } as never);
    await next();
  });
  app.use('*', middleware.handler);
  app.get('/test', (c) => c.json({ ok: true }));
  return { app, mw: middleware };
}

beforeEach(() => {
  __resetSharedPerTenantRateBudgetForTests();
});

// ---------------------------------------------------------------------------
// EVAL path (default) — verifies parity with the existing FakeRedis suite.
// ---------------------------------------------------------------------------

describe('per-tenant rate budget — ioredis-shaped EVAL path', () => {
  it('uses EVAL exactly once per request and serves under budget', async () => {
    const redis = new IoredisShapedFake();
    const { app } = makeApp({ hourlyTokenBudget: 1_000_000, redis });
    const res = await app.request('/test', {
      headers: { 'x-test-tenant': 'eval-A', 'content-length': '256' },
    });
    expect(res.status).toBe(200);
    expect(redis.evalCalls).toBe(1);
    // EVAL handles INCRBY + EXPIRE atomically — neither standalone call
    // should have fired on the EVAL-capable path.
    expect(redis.incrbyCalls).toBe(0);
    expect(redis.expireCalls).toBe(0);
  });

  it('blocks at the budget cap with 429 (EVAL path)', async () => {
    const redis = new IoredisShapedFake();
    const { app } = makeApp({
      hourlyTokenBudget: 100,
      windowMs: 60_000,
      redis,
    });
    const res = await app.request('/test', {
      headers: { 'x-test-tenant': 'eval-B', 'content-length': '4096' },
    });
    expect(res.status).toBe(429);
    expect(redis.evalCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// MULTI/EXEC fallback — managed-Redis tiers (e.g. Upstash, Vercel-KV)
// block scripting. The middleware must produce identical externally-
// visible behaviour against this path.
// ---------------------------------------------------------------------------

describe('per-tenant rate budget — MULTI/EXEC fallback (no-EVAL tier)', () => {
  it('falls through to INCRBY + EXPIRE when EVAL is unavailable', async () => {
    const redis = new IoredisShapedFake({ evalDisabled: true });
    const { app } = makeApp({ hourlyTokenBudget: 1_000_000, redis });
    const res = await app.request('/test', {
      headers: { 'x-test-tenant': 'noeval-A', 'content-length': '256' },
    });
    expect(res.status).toBe(200);
    // EVAL never called because we hid it on this fake.
    expect(redis.evalCalls).toBe(0);
    // INCRBY + EXPIRE both ran (DA1 MEDIUM finding: EXPIRE is now
    // unconditional in the fallback path to prevent the concurrent
    // first-touch race that would leak keys).
    expect(redis.incrbyCalls).toBe(1);
    expect(redis.expireCalls).toBe(1);
  });

  it('issues EXPIRE on every fallback call (DA1 race-fix invariant)', async () => {
    const redis = new IoredisShapedFake({ evalDisabled: true });
    const { app } = makeApp({
      hourlyTokenBudget: 1_000_000,
      windowMs: 60_000,
      redis,
    });
    await app.request('/test', {
      headers: { 'x-test-tenant': 'noeval-B', 'content-length': '256' },
    });
    await app.request('/test', {
      headers: { 'x-test-tenant': 'noeval-B', 'content-length': '256' },
    });
    // Two INCRBYs and two EXPIREs — the middleware no longer gates
    // EXPIRE on `total === cost` (would leak keys under concurrent
    // first-touch). EXPIRE is idempotent and cheap; both paths fire it.
    expect(redis.incrbyCalls).toBe(2);
    expect(redis.expireCalls).toBe(2);
  });

  it('blocks at the budget cap with 429 on the MULTI fallback path', async () => {
    const redis = new IoredisShapedFake({ evalDisabled: true });
    const { app } = makeApp({
      hourlyTokenBudget: 100,
      windowMs: 60_000,
      redis,
    });
    const res = await app.request('/test', {
      headers: { 'x-test-tenant': 'noeval-C', 'content-length': '4096' },
    });
    // External behaviour MUST match the EVAL path — same status, same
    // headers. If this drifts the two paths are out of contract.
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('isolates tenants on the MULTI fallback path', async () => {
    const redis = new IoredisShapedFake({ evalDisabled: true });
    const { app } = makeApp({
      hourlyTokenBudget: 64,
      windowMs: 60_000,
      redis,
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
    // Tenant B unaffected — bucket isolation must hold even when the
    // backing path is the multi-step fallback.
    expect(b1.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Breaker state-machine end-to-end with the ioredis-shaped fake.
// ---------------------------------------------------------------------------

describe('per-tenant rate budget — breaker (ioredis-shaped) state machine', () => {
  it('opens after threshold consecutive failures and short-circuits Redis', async () => {
    const redis = new IoredisShapedFake();
    redis.failPermanently = true;
    const { app, mw } = makeApp({
      hourlyTokenBudget: 1_000_000,
      redis,
      nodeEnv: 'development',
      breakerThreshold: 3,
      breakerCooldownMs: 30_000,
    });
    for (let i = 0; i < 3; i++) {
      await app.request('/test', {
        headers: { 'x-test-tenant': 'br-A', 'content-length': '256' },
      });
    }
    expect(mw.breakerState()).toBe('open');
    const evalCallsAtTrip = redis.evalCalls;
    // Once open, the middleware MUST skip the Redis call.
    await app.request('/test', {
      headers: { 'x-test-tenant': 'br-A', 'content-length': '256' },
    });
    expect(redis.evalCalls).toBe(evalCallsAtTrip);
  });

  it('closes the breaker after a successful call following cooldown', async () => {
    const redis = new IoredisShapedFake();
    redis.failPermanently = true;
    let now = 0;
    const { app, mw } = makeApp({
      hourlyTokenBudget: 1_000_000,
      redis,
      nodeEnv: 'development',
      breakerThreshold: 2,
      breakerCooldownMs: 1_000,
    });
    // Force the closure-scoped clock by calling the public handler with
    // failures — the middleware uses Date.now() internally so we trip
    // the breaker, recover Redis, advance time past cooldown, and expect
    // closed state.
    await app.request('/test', {
      headers: { 'x-test-tenant': 'br-B', 'content-length': '256' },
    });
    await app.request('/test', {
      headers: { 'x-test-tenant': 'br-B', 'content-length': '256' },
    });
    expect(mw.breakerState()).toBe('open');

    // Heal Redis. Wait for cooldown (1s) and observe a successful call
    // closes the breaker. We use real timers here because the middleware
    // depends on Date.now() and we did not inject a `clock`.
    redis.failPermanently = false;
    await new Promise((r) => setTimeout(r, 1_100));
    const res = await app.request('/test', {
      headers: { 'x-test-tenant': 'br-B', 'content-length': '256' },
    });
    expect(res.status).toBe(200);
    expect(mw.breakerState()).toBe('closed');
    // Suppress unused-variable lint for now in this readable narrative.
    void now;
  });
});

// ---------------------------------------------------------------------------
// remaining() diagnostic exercises redis.get() — surfaces divergence
// if the fallback path stops writing the canonical key shape.
// ---------------------------------------------------------------------------

describe('per-tenant rate budget — remaining() with ioredis-shaped GET', () => {
  it('reflects consumed tokens via redis.get() (EVAL path)', async () => {
    const redis = new IoredisShapedFake();
    const { app, mw } = makeApp({
      hourlyTokenBudget: 1_000_000,
      windowMs: 60_000,
      redis,
    });
    await app.request('/test', {
      headers: { 'x-test-tenant': 'rem-A', 'content-length': '256' },
    });
    const left = await mw.remaining('rem-A');
    expect(left).toBe(1_000_000 - 64);
    expect(redis.getCalls).toBe(1);
  });

  it('reflects consumed tokens via redis.get() (MULTI fallback path)', async () => {
    const redis = new IoredisShapedFake({ evalDisabled: true });
    const { app, mw } = makeApp({
      hourlyTokenBudget: 1_000_000,
      windowMs: 60_000,
      redis,
    });
    await app.request('/test', {
      headers: { 'x-test-tenant': 'rem-B', 'content-length': '256' },
    });
    const left = await mw.remaining('rem-B');
    // Parity with the EVAL path — same answer regardless of backing path.
    expect(left).toBe(1_000_000 - 64);
  });
});

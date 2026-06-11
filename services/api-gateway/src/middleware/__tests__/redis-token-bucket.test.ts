/**
 * Unit tests for the RSS-08 distributed token bucket and the
 * `rate-limiter.ts` fallback wiring.
 *
 * Covers:
 *   1. The Lua bucket: allows up to `capacity`, then denies (429-equivalent),
 *      and refills at `refillRatePerSec`.
 *   2. The cross-replica property: two `RedisTokenBucket` instances sharing one
 *      (fake) redis enforce ONE shared cap.
 *   3. `parseDecision` coercion of loose ioredis wire types.
 *   4. The fallback path: with no redis wired (REDIS_URL unset semantics) the
 *      middleware uses the in-process limiter; when the redis `eval` throws the
 *      middleware degrades to in-process rather than hard-failing the request.
 *
 * A hand-rolled fake ioredis (just `.eval`) keeps the suite hermetic — no
 * `ioredis-mock` dep, no live Redis. The fake implements the SAME token-bucket
 * arithmetic the Lua script does so the allow/deny/refill behaviour is exercised
 * end-to-end, not stubbed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import {
  RedisTokenBucket,
  parseDecision,
  type EvalCapableRedis,
} from '../redis-token-bucket';
import {
  perUserRateLimit,
  initRedisTokenBucket,
  __resetRedisTokenBucketForTests,
} from '../rate-limiter';

// ---------------------------------------------------------------------------
// Fake ioredis implementing the token-bucket Lua semantics in TS.
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number;
  ts: number;
}

class FakeRedis implements EvalCapableRedis {
  private readonly store = new Map<string, Bucket>();
  public failNext: Error | null = null;
  public evalCalls = 0;

  // Mirrors ioredis.eval(script, numKeys, ...args) and reproduces the Lua
  // refill-check-consume arithmetic so tests exercise real behaviour.
  async eval(
    _script: string,
    _numKeys: number,
    ...args: Array<string | number>
  ): Promise<[number, number, number]> {
    this.evalCalls += 1;
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    const key = String(args[0]);
    const capacity = Number(args[1]);
    const refill = Number(args[2]);
    const now = Number(args[3]);

    let bucket = this.store.get(key);
    if (!bucket) bucket = { tokens: capacity, ts: now };

    let elapsed = now - bucket.ts;
    if (elapsed < 0) elapsed = 0;
    let tokens = bucket.tokens + (elapsed / 1000) * refill;
    if (tokens > capacity) tokens = capacity;

    let allowed = 0;
    let retryAfter = 0;
    if (tokens >= 1) {
      tokens -= 1;
      allowed = 1;
    } else if (refill > 0) {
      retryAfter = Math.ceil((1 - tokens) / refill);
    } else {
      retryAfter = 1;
    }

    this.store.set(key, { tokens, ts: now });
    return [allowed, Math.floor(tokens), retryAfter];
  }
}

// ---------------------------------------------------------------------------
// RedisTokenBucket — allow/deny/refill + cross-replica shared cap.
// ---------------------------------------------------------------------------

describe('RedisTokenBucket', () => {
  it('allows up to capacity then denies', async () => {
    let now = 1_000_000;
    const redis = new FakeRedis();
    const bucket = new RedisTokenBucket({ redis, clock: () => now });
    const params = { capacity: 3, refillRatePerSec: 0.05 };

    const first = await bucket.consume('user-a', params);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);

    const second = await bucket.consume('user-a', params);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(1);

    const third = await bucket.consume('user-a', params);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    // Bucket drained — next call denied with a positive retryAfter.
    const fourth = await bucket.consume('user-a', params);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfter).toBeGreaterThan(0);
  });

  it('refills at refillRatePerSec', async () => {
    let now = 2_000_000;
    const redis = new FakeRedis();
    const bucket = new RedisTokenBucket({ redis, clock: () => now });
    // 1 token per second; capacity 1 so it drains in one call.
    const params = { capacity: 1, refillRatePerSec: 1 };

    expect((await bucket.consume('u', params)).allowed).toBe(true);
    expect((await bucket.consume('u', params)).allowed).toBe(false);

    // Advance 1s → exactly one token refilled → allowed again.
    now += 1000;
    expect((await bucket.consume('u', params)).allowed).toBe(true);

    // Drained again immediately.
    expect((await bucket.consume('u', params)).allowed).toBe(false);

    // Half a second → only 0.5 tokens → still denied.
    now += 500;
    expect((await bucket.consume('u', params)).allowed).toBe(false);
  });

  it('enforces ONE shared cap across two instances sharing one redis (cross-replica)', async () => {
    let now = 3_000_000;
    const redis = new FakeRedis();
    // Two buckets == two replicas pointing at the same Redis.
    const replicaA = new RedisTokenBucket({ redis, clock: () => now });
    const replicaB = new RedisTokenBucket({ redis, clock: () => now });
    const params = { capacity: 4, refillRatePerSec: 0.001 };

    let allowedCount = 0;
    // Interleave 10 requests across the two replicas against the same key.
    for (let i = 0; i < 10; i++) {
      const replica = i % 2 === 0 ? replicaA : replicaB;
      const d = await replica.consume('shared-key', params);
      if (d.allowed) allowedCount += 1;
    }

    // Despite two replicas, the shared bucket caps total grants at capacity.
    expect(allowedCount).toBe(4);
  });

  it('rejects when the redis eval call fails (so caller can degrade)', async () => {
    const redis = new FakeRedis();
    redis.failNext = new Error('redis down');
    const bucket = new RedisTokenBucket({ redis });
    await expect(
      bucket.consume('k', { capacity: 5, refillRatePerSec: 1 }),
    ).rejects.toThrow('redis down');
  });
});

// ---------------------------------------------------------------------------
// parseDecision — defensive coercion of loose wire types.
// ---------------------------------------------------------------------------

describe('parseDecision', () => {
  it('parses a numeric Lua array', () => {
    expect(parseDecision([1, 5, 0])).toEqual({
      allowed: true,
      remaining: 5,
      retryAfter: 0,
    });
  });

  it('coerces string elements (some redis clients stringify)', () => {
    expect(parseDecision(['0', '0', '12'])).toEqual({
      allowed: false,
      remaining: 0,
      retryAfter: 12,
    });
  });

  it('throws on a malformed result', () => {
    expect(() => parseDecision('nope')).toThrow();
    expect(() => parseDecision([1])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// rate-limiter.ts fallback wiring.
// ---------------------------------------------------------------------------

/**
 * Build a tiny Hono app whose perUser key is derived from `userId`. Each test
 * passes a UNIQUE userId so the process-local in-process bucket (a module-level
 * singleton that intentionally outlives `__resetRedisTokenBucketForTests`,
 * which only resets the Redis wiring) never carries drained state between
 * tests.
 */
function buildApp(userId: string) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth', { tenantId: 't1', userId } as never);
    await next();
  });
  app.use('*', perUserRateLimit({ windowMs: 60_000, max: 2 }));
  app.get('/ping', (c) => c.json({ ok: true }));
  return app;
}

describe('rate-limiter perUserRateLimit fallback path', () => {
  beforeEach(() => {
    __resetRedisTokenBucketForTests();
  });

  it('falls back to the in-process limiter when no redis is wired', async () => {
    // No initRedisTokenBucket call + no REDIS_URL → in-process bucket.
    delete process.env.REDIS_URL;
    const app = buildApp('no-redis-user');

    const r1 = await app.request('/ping');
    const r2 = await app.request('/ping');
    const r3 = await app.request('/ping');

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // Third request exceeds max=2 → 429 from the in-process limiter.
    expect(r3.status).toBe(429);
  });

  it('uses the injected redis bucket when wired, and the cap is enforced', async () => {
    const redis = new FakeRedis();
    initRedisTokenBucket({ redis });
    const app = buildApp('redis-wired-user');

    const r1 = await app.request('/ping');
    const r2 = await app.request('/ping');
    const r3 = await app.request('/ping');

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    // Every decision went through the distributed bucket.
    expect(redis.evalCalls).toBe(3);
  });

  it('degrades to the in-process limiter when the redis bucket throws', async () => {
    const redis = new FakeRedis();
    redis.failNext = new Error('boom'); // only the first eval fails
    initRedisTokenBucket({ redis });
    const app = buildApp('degrade-user');

    // First request: redis throws → degrade → in-process allows it.
    const r1 = await app.request('/ping');
    expect(r1.status).toBe(200);
    // Subsequent requests resume on redis (failNext was one-shot); cap still
    // enforced — the request never hard-failed because of the Redis blip.
    const r2 = await app.request('/ping');
    expect([200, 429]).toContain(r2.status);
  });
});

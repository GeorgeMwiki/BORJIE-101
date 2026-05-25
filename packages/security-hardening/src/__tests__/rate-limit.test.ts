import { describe, it, expect } from 'vitest';

import {
  createInMemoryRateLimitStore,
} from '../rate-limit/store.js';
import {
  createRateLimiter,
  createRateLimitMiddleware,
} from '../rate-limit/limiter.js';

describe('token-bucket limiter', () => {
  it('allows up to capacity, then refills at refillPerMs', async () => {
    let t = 1_000;
    const limiter = createRateLimiter({
      algorithm: 'tokenBucket',
      store: createInMemoryRateLimitStore(),
      limits: { algorithm: 'tokenBucket', capacity: 3, refillPerMs: 0.001 }, // 1 token/sec
      now: () => t,
    });
    // First 3 requests consume the bucket
    expect((await limiter.consume('k')).allowed).toBe(true);
    expect((await limiter.consume('k')).allowed).toBe(true);
    expect((await limiter.consume('k')).allowed).toBe(true);
    // 4th is blocked + reports retry-after
    const blocked = await limiter.consume('k');
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    // After 2 seconds 2 tokens have refilled — allow 2 more
    t += 2_000;
    expect((await limiter.consume('k')).allowed).toBe(true);
    expect((await limiter.consume('k')).allowed).toBe(true);
    expect((await limiter.consume('k')).allowed).toBe(false);
  });

  it('separate keys have independent buckets', async () => {
    const limiter = createRateLimiter({
      algorithm: 'tokenBucket',
      store: createInMemoryRateLimitStore(),
      limits: { algorithm: 'tokenBucket', capacity: 1, refillPerMs: 0 },
      now: () => 1,
    });
    expect((await limiter.consume('alice')).allowed).toBe(true);
    expect((await limiter.consume('bob')).allowed).toBe(true);
    expect((await limiter.consume('alice')).allowed).toBe(false);
    expect((await limiter.consume('bob')).allowed).toBe(false);
  });

  it('refills are capped at capacity (no infinite accumulation)', async () => {
    let t = 0;
    const limiter = createRateLimiter({
      algorithm: 'tokenBucket',
      store: createInMemoryRateLimitStore(),
      limits: { algorithm: 'tokenBucket', capacity: 2, refillPerMs: 1 },
      now: () => t,
    });
    // Consume both
    await limiter.consume('k');
    await limiter.consume('k');
    // Wait WAY longer than needed to refill
    t = 10_000_000;
    // Should still allow only 2 in a row, not 10 million
    expect((await limiter.consume('k')).allowed).toBe(true);
    expect((await limiter.consume('k')).allowed).toBe(true);
    expect((await limiter.consume('k')).allowed).toBe(false);
  });
});

describe('sliding-window limiter', () => {
  it('blocks once the rolling-window count exceeds the limit', async () => {
    let t = 1_000;
    const limiter = createRateLimiter({
      algorithm: 'slidingWindow',
      store: createInMemoryRateLimitStore(),
      limits: { algorithm: 'slidingWindow', limit: 3, windowMs: 10_000 },
      now: () => t,
    });
    expect((await limiter.consume('k')).allowed).toBe(true);
    t += 1_000;
    expect((await limiter.consume('k')).allowed).toBe(true);
    t += 1_000;
    expect((await limiter.consume('k')).allowed).toBe(true);
    t += 1_000;
    expect((await limiter.consume('k')).allowed).toBe(false);
  });

  it('admits new requests once old ones fall out of the window', async () => {
    let t = 1_000;
    const limiter = createRateLimiter({
      algorithm: 'slidingWindow',
      store: createInMemoryRateLimitStore(),
      limits: { algorithm: 'slidingWindow', limit: 2, windowMs: 5_000 },
      now: () => t,
    });
    expect((await limiter.consume('k')).allowed).toBe(true);
    expect((await limiter.consume('k')).allowed).toBe(true);
    expect((await limiter.consume('k')).allowed).toBe(false);
    // Skip well past windowMs so both old timestamps drop off
    t += 10_000;
    expect((await limiter.consume('k')).allowed).toBe(true);
  });

  it('remaining counter decrements then resets after the window', async () => {
    let t = 0;
    const limiter = createRateLimiter({
      algorithm: 'slidingWindow',
      store: createInMemoryRateLimitStore(),
      limits: { algorithm: 'slidingWindow', limit: 5, windowMs: 1_000 },
      now: () => t,
    });
    const r1 = await limiter.consume('k');
    expect(r1.remaining).toBe(4);
    const r2 = await limiter.consume('k');
    expect(r2.remaining).toBe(3);
  });
});

describe('fixed-window limiter', () => {
  it('counts within a single window then resets', async () => {
    let t = 1_000;
    const limiter = createRateLimiter({
      algorithm: 'fixedWindow',
      store: createInMemoryRateLimitStore(),
      limits: { algorithm: 'fixedWindow', limit: 3, windowMs: 5_000 },
      now: () => t,
    });
    expect((await limiter.consume('k')).allowed).toBe(true);
    expect((await limiter.consume('k')).allowed).toBe(true);
    expect((await limiter.consume('k')).allowed).toBe(true);
    expect((await limiter.consume('k')).allowed).toBe(false);
    // New window
    t += 6_000;
    expect((await limiter.consume('k')).allowed).toBe(true);
  });
});

describe('algorithm/limits mismatch', () => {
  it('throws when algorithm and limits.algorithm disagree', () => {
    expect(() =>
      createRateLimiter({
        algorithm: 'tokenBucket',
        store: createInMemoryRateLimitStore(),
        limits: {
          algorithm: 'slidingWindow',
          limit: 1,
          windowMs: 1,
        },
      }),
    ).toThrow();
  });
});

describe('rate-limit middleware', () => {
  function buildCtx(): {
    readonly ctx: {
      readonly req: { readonly path: string; readonly method: string };
      readonly res: { readonly headers: { set(k: string, v: string): void } };
      header(name: string, value: string): void;
      json(body: unknown, status?: number): void;
      status(code: number): void;
      readonly stored: Map<string, string>;
      lastStatus?: number;
      lastJson?: unknown;
    };
  } {
    const stored = new Map<string, string>();
    const ctx = {
      req: { path: '/p', method: 'GET' },
      res: {
        headers: {
          set(k: string, v: string) {
            stored.set(k, v);
          },
        },
      },
      header(name: string, value: string) {
        stored.set(name, value);
      },
      json(body: unknown, status?: number) {
        (ctx as { lastJson?: unknown }).lastJson = body;
        if (status) (ctx as { lastStatus?: number }).lastStatus = status;
      },
      status(code: number) {
        (ctx as { lastStatus?: number }).lastStatus = code;
      },
      stored,
    };
    return { ctx };
  }

  it('lets allowed requests through + sets X-RateLimit-* headers', async () => {
    const limiter = createRateLimiter({
      algorithm: 'fixedWindow',
      store: createInMemoryRateLimitStore(),
      limits: { algorithm: 'fixedWindow', limit: 2, windowMs: 1_000 },
    });
    const mw = createRateLimitMiddleware({
      limiter,
      keyOf: (c) => c.req.path,
    });
    const { ctx } = buildCtx();
    let nextCalled = false;
    await mw(ctx, async () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(ctx.stored.get('X-RateLimit-Limit')).toBe('2');
    expect(ctx.stored.get('X-RateLimit-Remaining')).toBe('1');
  });

  it('short-circuits blocked requests with 429 + Retry-After', async () => {
    const limiter = createRateLimiter({
      algorithm: 'fixedWindow',
      store: createInMemoryRateLimitStore(),
      limits: { algorithm: 'fixedWindow', limit: 1, windowMs: 1_000 },
    });
    const mw = createRateLimitMiddleware({
      limiter,
      keyOf: () => 'shared',
    });
    const { ctx: c1 } = buildCtx();
    const { ctx: c2 } = buildCtx();
    await mw(c1, async () => {});
    let secondNext = false;
    await mw(c2, async () => {
      secondNext = true;
    });
    expect(secondNext).toBe(false);
    expect(c2.lastStatus).toBe(429);
    expect(c2.stored.get('Retry-After')).toBeDefined();
  });
});

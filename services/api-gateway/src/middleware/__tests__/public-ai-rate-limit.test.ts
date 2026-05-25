/**
 * Public AI rate-limit middleware — sliding-window + token-budget tests.
 *
 * These tests use Hono's in-memory `app.request()` so we don't need a
 * live HTTP listener. The middleware's clock + ipExtractor are
 * injected so we can advance time deterministically and target
 * specific buckets.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createPublicAiRateLimitMiddleware } from '../public-ai-rate-limit';

function appWith(opts: Parameters<typeof createPublicAiRateLimitMiddleware>[0] = {}) {
  const mw = createPublicAiRateLimitMiddleware(opts);
  const app = new Hono();
  app.post('/probe', mw.handler, (c) => {
    const hash = (c.get('publicIpHash' as never) as string | undefined) ?? '';
    return c.json({ ok: true, ipHash: hash });
  });
  return { app, mw };
}

function postJson(body: unknown, headers: Record<string, string> = {}) {
  const payload = JSON.stringify(body);
  return new Request('http://test.local/probe', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(payload, 'utf8')),
      ...headers,
    },
    body: payload,
  });
}

describe('public-ai-rate-limit — request-count window', () => {
  it('lets the first N requests pass and 429s the (N+1)th', async () => {
    const { app, mw } = appWith({
      window: 60_000,
      maxRequestsPerWindow: 20,
      tokenBudgetPerWindow: 1_000_000, // disable budget axis for this test
      salt: 'test-salt',
      ipExtractor: () => '203.0.113.1',
    });

    for (let i = 0; i < 20; i++) {
      const res = await app.request(postJson({ message: 'hi' }, { 'x-forwarded-for': '203.0.113.1' }));
      expect(res.status).toBe(200);
    }

    const overLimit = await app.request(postJson({ message: 'hi' }, { 'x-forwarded-for': '203.0.113.1' }));
    expect(overLimit.status).toBe(429);
    const json = (await overLimit.json()) as { error: { code: string; retryAfter: number } };
    expect(json.error.code).toBe('PUBLIC_RATE_LIMIT_EXCEEDED');
    expect(json.error.retryAfter).toBeGreaterThan(0);
    expect(overLimit.headers.get('Retry-After')).toBeTruthy();

    // bucket should hold exactly 20 — the 21st was rejected before commit
    const bucketKey = [...mw.buckets.keys()][0]!;
    expect(mw.buckets.get(bucketKey)?.count).toBe(20);
  });
});

describe('public-ai-rate-limit — token-budget window', () => {
  it('429s when total request bytes blow the budget', async () => {
    // 5 calls, each ~7,000 bytes of body. Budget = 30,000 → call #5
    // should bust the budget without blowing the count axis (5 < 20).
    const { app } = appWith({
      window: 60_000,
      maxRequestsPerWindow: 100,
      tokenBudgetPerWindow: 30_000,
      salt: 'test-salt',
      ipExtractor: () => '203.0.113.2',
    });

    const big = { message: 'x'.repeat(7_000) };
    let lastStatus = 0;
    for (let i = 0; i < 5; i++) {
      const res = await app.request(postJson(big, { 'x-forwarded-for': '203.0.113.2' }));
      lastStatus = res.status;
      if (res.status === 429) {
        const json = (await res.json()) as { error: { code: string } };
        expect(json.error.code).toBe('PUBLIC_TOKEN_BUDGET_EXCEEDED');
        return;
      }
    }
    // If we never tripped, the assertion below fails the test.
    expect(lastStatus).toBe(429);
  });
});

describe('public-ai-rate-limit — bucket isolation', () => {
  it('counts different ipHashes independently', async () => {
    const { app } = appWith({
      window: 60_000,
      maxRequestsPerWindow: 2,
      tokenBudgetPerWindow: 1_000_000,
      salt: 'test-salt',
      // dynamic extractor reads from the header so each request can land
      // in its own bucket
      ipExtractor: (c) => c.req.header('x-forwarded-for') ?? 'unknown',
    });

    // Two calls from IP A — both pass (within max=2)
    expect(
      (await app.request(postJson({ msg: 1 }, { 'x-forwarded-for': '198.51.100.1' }))).status,
    ).toBe(200);
    expect(
      (await app.request(postJson({ msg: 1 }, { 'x-forwarded-for': '198.51.100.1' }))).status,
    ).toBe(200);

    // First call from IP B passes — independent bucket.
    expect(
      (await app.request(postJson({ msg: 1 }, { 'x-forwarded-for': '198.51.100.2' }))).status,
    ).toBe(200);

    // Third call from IP A blows its bucket but IP B's still has space.
    expect(
      (await app.request(postJson({ msg: 1 }, { 'x-forwarded-for': '198.51.100.1' }))).status,
    ).toBe(429);
    expect(
      (await app.request(postJson({ msg: 1 }, { 'x-forwarded-for': '198.51.100.2' }))).status,
    ).toBe(200);
  });
});

describe('public-ai-rate-limit — window expiry', () => {
  it('resets the bucket once the window has elapsed', async () => {
    let now = 1_000_000;
    const { app } = appWith({
      window: 1_000,
      maxRequestsPerWindow: 1,
      tokenBudgetPerWindow: 1_000_000,
      salt: 'test-salt',
      clock: () => now,
      ipExtractor: () => '203.0.113.3',
    });

    // First call passes, second is rejected (max=1)
    expect((await app.request(postJson({}))).status).toBe(200);
    expect((await app.request(postJson({}))).status).toBe(429);

    // Advance time past the window — bucket should reset.
    now += 1_500;
    expect((await app.request(postJson({}))).status).toBe(200);
  });
});

describe('public-ai-rate-limit — context propagation', () => {
  it('exposes a stable publicIpHash to downstream handlers', async () => {
    const { app } = appWith({
      window: 60_000,
      maxRequestsPerWindow: 5,
      tokenBudgetPerWindow: 1_000_000,
      salt: 'a-stable-salt',
      ipExtractor: () => '203.0.113.4',
    });

    const r1 = await app.request(postJson({ msg: 'one' }));
    const r2 = await app.request(postJson({ msg: 'two' }));
    const j1 = (await r1.json()) as { ipHash: string };
    const j2 = (await r2.json()) as { ipHash: string };

    // Same source IP + salt → same hash across calls
    expect(j1.ipHash.length).toBe(64);
    expect(j2.ipHash).toBe(j1.ipHash);
  });
});

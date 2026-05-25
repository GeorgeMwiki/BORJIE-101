/**
 * Token-bucket rate-limit coverage for createBaseConnector — verifies
 * burst capacity, deterministic refill via injected clock, and
 * retryAfterMs computation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBaseConnector, type ConnectorConfig } from '../base-connector.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1_000_000;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const baseConfig: ConnectorConfig = {
  id: 'rl-test',
  displayName: 'Rate Limit Test',
  baseUrl: 'https://api.example.test',
  retry: { maxAttempts: 1, initialDelayMs: 1 },
  timeoutMs: 5_000,
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1 });
});

describe('createBaseConnector — token bucket capacity', () => {
  it('allows up to burst calls before throttling', async () => {
    const clock = makeClock();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({
      config: { ...baseConfig, rateLimit: { rpm: 60, burst: 3 } },
      fetch: fetchMock,
      clock: clock.now,
    });

    const a = await connector.call({ path: '/a', method: 'GET' });
    const b = await connector.call({ path: '/b', method: 'GET' });
    const c = await connector.call({ path: '/c', method: 'GET' });
    const d = await connector.call({ path: '/d', method: 'GET' });

    expect(a.kind).toBe('ok');
    expect(b.kind).toBe('ok');
    expect(c.kind).toBe('ok');
    expect(d.kind).toBe('rate-limited');
  });

  it('defaults burst to rpm when not supplied', async () => {
    const clock = makeClock();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({
      config: { ...baseConfig, rateLimit: { rpm: 2 } },
      fetch: fetchMock,
      clock: clock.now,
    });

    const a = await connector.call({ path: '/a', method: 'GET' });
    const b = await connector.call({ path: '/b', method: 'GET' });
    const c = await connector.call({ path: '/c', method: 'GET' });

    expect(a.kind).toBe('ok');
    expect(b.kind).toBe('ok');
    expect(c.kind).toBe('rate-limited');
  });
});

describe('createBaseConnector — token bucket refill', () => {
  it('refills enough tokens to allow another call after time passes', async () => {
    const clock = makeClock();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({
      // 60 rpm = 1 token/sec
      config: { ...baseConfig, rateLimit: { rpm: 60, burst: 1 } },
      fetch: fetchMock,
      clock: clock.now,
    });

    expect((await connector.call({ path: '/a', method: 'GET' })).kind).toBe('ok');
    expect((await connector.call({ path: '/b', method: 'GET' })).kind).toBe('rate-limited');

    // Advance >= 1s so one full token regenerates
    clock.advance(1_500);

    expect((await connector.call({ path: '/c', method: 'GET' })).kind).toBe('ok');
  });

  it('reports retryAfterMs proportional to deficit / refill rate', async () => {
    const clock = makeClock();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({
      // 60 rpm => refill = 1 token/sec
      config: { ...baseConfig, rateLimit: { rpm: 60, burst: 1 } },
      fetch: fetchMock,
      clock: clock.now,
    });

    await connector.call({ path: '/a', method: 'GET' });
    const out = await connector.call({ path: '/b', method: 'GET' });

    expect(out.kind).toBe('rate-limited');
    if (out.kind === 'rate-limited') {
      // 1 token at 1/sec => around 1000ms
      expect(out.retryAfterMs).toBeGreaterThanOrEqual(900);
      expect(out.retryAfterMs).toBeLessThanOrEqual(1100);
    }
  });
});

describe('createBaseConnector — defaults applied when no rateLimit', () => {
  it('does not throttle a few calls under default rpm=600 burst=600', async () => {
    const clock = makeClock();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({
      config: { ...baseConfig },
      fetch: fetchMock,
      clock: clock.now,
    });

    for (let i = 0; i < 10; i++) {
      const out = await connector.call({ path: `/x${i}`, method: 'GET' });
      expect(out.kind).toBe('ok');
    }
  });
});

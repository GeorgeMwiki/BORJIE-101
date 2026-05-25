/**
 * Circuit-breaker coverage for createBaseConnector — focuses on edge cases
 * not covered in the headline base-connector test:
 *   - 4xx failures count toward the threshold
 *   - transport errors count
 *   - successes reset error counter while closed
 *   - health() reports lastErrorAt + errorCount
 *   - health() advances state from open->half-open as side-effect
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBaseConnector, type ConnectorConfig } from '../base-connector.js';
import { createInMemoryEventSink } from '../in-memory-event-sink.js';

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
  id: 'cb-test',
  displayName: 'CB Test',
  baseUrl: 'https://api.example.test',
  rateLimit: { rpm: 600, burst: 50 },
  retry: { maxAttempts: 1, initialDelayMs: 1 },
  timeoutMs: 5_000,
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1 });
});

describe('createBaseConnector — circuit-breaker error counting', () => {
  it('4xx failures count toward the open threshold', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { message: 'bad' }));
    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        circuitBreaker: { errorThreshold: 2, halfOpenAfterMs: 30_000 },
      },
      fetch: fetchMock,
    });

    await connector.call({ path: '/x', method: 'GET' });
    expect(connector.health().state).toBe('closed');
    await connector.call({ path: '/x', method: 'GET' });
    expect(connector.health().state).toBe('open');
  });

  it('transport errors count toward the open threshold', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        retry: { maxAttempts: 1, initialDelayMs: 1 },
        circuitBreaker: { errorThreshold: 2, halfOpenAfterMs: 30_000 },
      },
      fetch: fetchMock,
    });

    await connector.call({ path: '/x', method: 'GET' });
    expect(connector.health().state).toBe('closed');
    await connector.call({ path: '/x', method: 'GET' });
    expect(connector.health().state).toBe('open');
  });

  it('a single success in closed state resets the error counter', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { message: 'down' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(jsonResponse(500, { message: 'down' }));

    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        circuitBreaker: { errorThreshold: 2, halfOpenAfterMs: 30_000 },
      },
      fetch: fetchMock,
    });

    await connector.call({ path: '/x', method: 'GET' });
    expect(connector.health().errorCount).toBe(1);

    await connector.call({ path: '/x', method: 'GET' });
    expect(connector.health().errorCount).toBe(0);

    await connector.call({ path: '/x', method: 'GET' });
    expect(connector.health().state).toBe('closed');
    expect(connector.health().errorCount).toBe(1);
  });

  it('health() reports the timestamp of the most recent error', async () => {
    const clock = makeClock();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(500, { message: 'down' }));

    const connector = createBaseConnector({
      config: { ...baseConfig, circuitBreaker: { errorThreshold: 5, halfOpenAfterMs: 30_000 } },
      fetch: fetchMock,
      clock: clock.now,
    });

    expect(connector.health().lastErrorAt).toBeNull();
    await connector.call({ path: '/x', method: 'GET' });
    expect(connector.health().lastErrorAt).toMatch(/T/);
  });
});

describe('createBaseConnector — circuit-breaker half-open transition via health()', () => {
  it('health() promotes open -> half-open after cool-down', async () => {
    const clock = makeClock();
    const events = createInMemoryEventSink();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(500, { message: 'down' }));

    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        circuitBreaker: { errorThreshold: 1, halfOpenAfterMs: 5_000 },
      },
      fetch: fetchMock,
      events,
      clock: clock.now,
    });

    await connector.call({ path: '/x', method: 'GET' });
    expect(connector.health().state).toBe('open');

    clock.advance(5_500);
    expect(connector.health().state).toBe('half-open');
    expect(events.events().some((e) => e.kind === 'circuit-half-open')).toBe(true);
  });

  it('does not advance to half-open before the cool-down elapses', async () => {
    const clock = makeClock();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(500, { message: 'down' }));

    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        circuitBreaker: { errorThreshold: 1, halfOpenAfterMs: 5_000 },
      },
      fetch: fetchMock,
      clock: clock.now,
    });

    await connector.call({ path: '/x', method: 'GET' });
    clock.advance(2_000);
    expect(connector.health().state).toBe('open');
  });
});

describe('createBaseConnector — circuit defaults', () => {
  it('defaults errorThreshold to 5 when not configured', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(500, { message: 'down' }));
    const connector = createBaseConnector({
      config: { ...baseConfig },
      fetch: fetchMock,
    });

    for (let i = 0; i < 4; i++) {
      await connector.call({ path: '/x', method: 'GET' });
      expect(connector.health().state).toBe('closed');
    }
    await connector.call({ path: '/x', method: 'GET' });
    expect(connector.health().state).toBe('open');
  });
});

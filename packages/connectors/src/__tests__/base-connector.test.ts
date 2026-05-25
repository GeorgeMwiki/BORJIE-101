/**
 * Unit tests for createBaseConnector.
 *
 * Strategy: inject vi.fn fetch + a controllable clock + in-memory sinks.
 * No timers or real network so tests are deterministic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  createBaseConnector,
  type ConnectorConfig,
  type ConnectorOutcome,
} from '../base-connector.js';
import { createInMemoryEventSink } from '../in-memory-event-sink.js';
import { createInMemoryAuditSink } from '../in-memory-audit-sink.js';

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
  id: 'test',
  displayName: 'Test',
  baseUrl: 'https://api.example.test',
  rateLimit: { rpm: 600, burst: 5 },
  circuitBreaker: { errorThreshold: 3, halfOpenAfterMs: 30_000 },
  retry: { maxAttempts: 3, initialDelayMs: 1 },
  timeoutMs: 5_000,
};

beforeEach(() => {
  // No real backoff — make jitter-driven sleep effectively instant.
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1 });
});

describe('createBaseConnector — happy path', () => {
  it('returns ok, parses JSON, emits request+response, audits ok', async () => {
    const clock = makeClock();
    const events = createInMemoryEventSink();
    const audit = createInMemoryAuditSink();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { hello: 'world' }));

    const connector = createBaseConnector({
      config: baseConfig,
      fetch: fetchMock,
      events,
      audit,
      clock: clock.now,
    });

    const out = await connector.call({ path: '/ping', method: 'GET' });

    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.data).toEqual({ hello: 'world' });
      expect(out.attempt).toBe(1);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const eventKinds = events.events().map((e) => e.kind);
    expect(eventKinds).toContain('request');
    expect(eventKinds).toContain('response');

    expect(audit.entries()).toHaveLength(1);
    expect(audit.entries()[0]).toMatchObject({ outcome: 'ok', connectorId: 'test', path: '/ping' });
  });
});

describe('createBaseConnector — 4xx', () => {
  it('returns upstream-error without retry, audits failed', async () => {
    const clock = makeClock();
    const audit = createInMemoryAuditSink();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { message: 'not found' }));

    const connector = createBaseConnector({
      config: baseConfig,
      fetch: fetchMock,
      audit,
      clock: clock.now,
    });

    const out = await connector.call({ path: '/missing', method: 'GET' });

    expect(out.kind).toBe('upstream-error');
    if (out.kind === 'upstream-error') {
      expect(out.status).toBe(404);
      expect(out.message).toBe('not found');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(audit.entries()[0]?.outcome).toBe('failed');
  });
});

describe('createBaseConnector — 5xx retry', () => {
  it('retries up to maxAttempts then upstream-error', async () => {
    const clock = makeClock();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503, { message: 'down' }));

    const connector = createBaseConnector({
      config: baseConfig,
      fetch: fetchMock,
      clock: clock.now,
    });

    const out = await connector.call({ path: '/x', method: 'GET' });

    expect(out.kind).toBe('upstream-error');
    if (out.kind === 'upstream-error') expect(out.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('createBaseConnector — transport error retry', () => {
  it('retries on network error then transport-error', async () => {
    const clock = makeClock();
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

    const connector = createBaseConnector({
      config: baseConfig,
      fetch: fetchMock,
      clock: clock.now,
    });

    const out = await connector.call({ path: '/x', method: 'GET' });

    expect(out.kind).toBe('transport-error');
    if (out.kind === 'transport-error') {
      expect(out.message).toBe('ECONNRESET');
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('createBaseConnector — timeout', () => {
  it('AbortController fires, returns transport-error', async () => {
    const clock = makeClock();
    // Real timers needed for AbortController to actually abort an in-flight Promise.
    vi.useRealTimers();

    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }
      });
    });

    const connector = createBaseConnector({
      config: { ...baseConfig, timeoutMs: 25, retry: { maxAttempts: 1, initialDelayMs: 1 } },
      fetch: fetchMock,
      clock: clock.now,
    });

    const out = await connector.call({ path: '/slow', method: 'GET' });

    expect(out.kind).toBe('transport-error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('createBaseConnector — rate limit', () => {
  it('returns rate-limited when token bucket is exhausted', async () => {
    const clock = makeClock();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    const connector = createBaseConnector({
      config: { ...baseConfig, rateLimit: { rpm: 60, burst: 2 }, retry: { maxAttempts: 1, initialDelayMs: 1 } },
      fetch: fetchMock,
      clock: clock.now,
    });

    const a = await connector.call({ path: '/a', method: 'GET' });
    const b = await connector.call({ path: '/b', method: 'GET' });
    const c = await connector.call({ path: '/c', method: 'GET' });

    expect(a.kind).toBe('ok');
    expect(b.kind).toBe('ok');
    expect(c.kind).toBe('rate-limited');
    if (c.kind === 'rate-limited') {
      expect(c.retryAfterMs).toBeGreaterThan(0);
    }
  });
});

describe('createBaseConnector — circuit breaker opens', () => {
  it('opens after threshold consecutive failures', async () => {
    const clock = makeClock();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { message: 'boom' }));
    const events = createInMemoryEventSink();

    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        circuitBreaker: { errorThreshold: 2, halfOpenAfterMs: 30_000 },
        retry: { maxAttempts: 1, initialDelayMs: 1 },
      },
      fetch: fetchMock,
      events,
      clock: clock.now,
    });

    await connector.call({ path: '/x', method: 'GET' });
    expect(connector.health().state).toBe('closed');
    await connector.call({ path: '/x', method: 'GET' });
    expect(connector.health().state).toBe('open');

    const opened = events.events().filter((e) => e.kind === 'circuit-opened');
    expect(opened).toHaveLength(1);
  });
});

describe('createBaseConnector — circuit-open short-circuits', () => {
  it('short-circuits subsequent calls until cooldown elapses', async () => {
    const clock = makeClock();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { message: 'boom' }));

    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        circuitBreaker: { errorThreshold: 1, halfOpenAfterMs: 5_000 },
        retry: { maxAttempts: 1, initialDelayMs: 1 },
      },
      fetch: fetchMock,
      clock: clock.now,
    });

    await connector.call({ path: '/x', method: 'GET' });
    expect(connector.health().state).toBe('open');

    fetchMock.mockClear();
    const out = await connector.call({ path: '/x', method: 'GET' });
    expect(out.kind).toBe('circuit-open');
    expect(fetchMock).not.toHaveBeenCalled();

    // Advance past cool-down → next call should attempt (half-open probe).
    clock.advance(6_000);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const out2 = await connector.call({ path: '/x', method: 'GET' });
    expect(out2.kind).toBe('ok');
    expect(connector.health().state).toBe('closed');
  });
});

describe('createBaseConnector — half-open success closes', () => {
  it('first success in half-open transitions to closed', async () => {
    const clock = makeClock();
    const events = createInMemoryEventSink();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { message: 'boom' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        circuitBreaker: { errorThreshold: 1, halfOpenAfterMs: 5_000 },
        retry: { maxAttempts: 1, initialDelayMs: 1 },
      },
      fetch: fetchMock,
      events,
      clock: clock.now,
    });

    await connector.call({ path: '/x', method: 'GET' });
    clock.advance(6_000);
    const out = await connector.call({ path: '/x', method: 'GET' });

    expect(out.kind).toBe('ok');
    expect(connector.health().state).toBe('closed');
    expect(events.events().some((e) => e.kind === 'circuit-half-open')).toBe(true);
    expect(events.events().some((e) => e.kind === 'circuit-closed')).toBe(true);
  });
});

describe('createBaseConnector — half-open failure re-opens', () => {
  it('failure during half-open transitions back to open', async () => {
    const clock = makeClock();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { message: 'boom' }))
      .mockResolvedValueOnce(jsonResponse(500, { message: 'still down' }));

    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        circuitBreaker: { errorThreshold: 1, halfOpenAfterMs: 5_000 },
        retry: { maxAttempts: 1, initialDelayMs: 1 },
      },
      fetch: fetchMock,
      clock: clock.now,
    });

    await connector.call({ path: '/x', method: 'GET' });
    clock.advance(6_000);
    await connector.call({ path: '/x', method: 'GET' });

    expect(connector.health().state).toBe('open');
  });
});

describe('createBaseConnector — bearer auth', () => {
  it('sets Authorization: Bearer header from token provider', async () => {
    const clock = makeClock();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        auth: { kind: 'bearer', token: async () => 'token-abc' },
      },
      fetch: fetchMock,
      clock: clock.now,
    });

    await connector.call({ path: '/x', method: 'GET' });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer token-abc');
  });
});

describe('createBaseConnector — oauth2 401 refresh + retry', () => {
  it('on 401 calls refresh() once and retries within same attempt', async () => {
    const clock = makeClock();
    const events = createInMemoryEventSink();

    let tokenValue = 'stale';
    const refresh = vi.fn(async () => {
      tokenValue = 'fresh';
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { message: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        retry: { maxAttempts: 1, initialDelayMs: 1 },
        auth: {
          kind: 'oauth2',
          accessTokenProvider: async () => tokenValue,
          refresh,
        },
      },
      fetch: fetchMock,
      events,
      clock: clock.now,
    });

    const out = await connector.call({ path: '/secure', method: 'GET' });

    expect(out.kind).toBe('ok');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events.events().some((e) => e.kind === 'auth-refreshed')).toBe(true);

    const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    const secondHeaders = secondInit?.headers as Record<string, string> | undefined;
    expect(secondHeaders?.Authorization).toBe('Bearer fresh');
  });
});

describe('createBaseConnector — output Zod validation', () => {
  const schema = z.object({ id: z.string(), n: z.number() });

  it('passes valid output through', async () => {
    const clock = makeClock();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'a', n: 1 }));

    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock, clock: clock.now });
    const out: ConnectorOutcome<unknown> = await connector.call({
      path: '/x',
      method: 'GET',
      outputSchema: schema,
    });
    expect(out.kind).toBe('ok');
  });

  it('returns validation-failed on shape mismatch', async () => {
    const clock = makeClock();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 1, n: 'oops' }));

    const connector = createBaseConnector({
      config: { ...baseConfig, retry: { maxAttempts: 1, initialDelayMs: 1 } },
      fetch: fetchMock,
      clock: clock.now,
    });
    const out = await connector.call({ path: '/x', method: 'GET', outputSchema: schema });
    expect(out.kind).toBe('validation-failed');
  });
});

describe('createBaseConnector — idempotency key', () => {
  it('passes Idempotency-Key header to fetch when set', async () => {
    const clock = makeClock();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock, clock: clock.now });
    await connector.call({
      path: '/charge',
      method: 'POST',
      body: { amount: 10 },
      idempotencyKey: 'charge-abc-123',
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.['Idempotency-Key']).toBe('charge-abc-123');
  });
});

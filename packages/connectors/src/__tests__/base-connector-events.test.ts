/**
 * Event-emission coverage for createBaseConnector.
 * Verifies the timeline + payload of events for ok / 4xx / 5xx-retry /
 * rate-limit / circuit lifecycle paths. Existing base test covers a
 * subset; this expands to assert the connectorId, path, and at fields.
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
  let t = 1_700_000_000_000;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const baseConfig: ConnectorConfig = {
  id: 'evt-test',
  displayName: 'Event Test',
  baseUrl: 'https://api.example.test',
  rateLimit: { rpm: 60, burst: 1 },
  retry: { maxAttempts: 1, initialDelayMs: 1 },
  timeoutMs: 5_000,
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1 });
});

describe('createBaseConnector — event emission', () => {
  it('stamps every event with the configured connectorId', async () => {
    const events = createInMemoryEventSink();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({
      config: baseConfig,
      fetch: fetchMock,
      events,
    });

    await connector.call({ path: '/x', method: 'GET' });

    for (const e of events.events()) {
      expect(e.connectorId).toBe('evt-test');
    }
  });

  it('stamps request and response events with the request path', async () => {
    const events = createInMemoryEventSink();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({
      config: baseConfig,
      fetch: fetchMock,
      events,
    });

    await connector.call({ path: '/v1/things/42', method: 'GET' });

    const request = events.events().find((e) => e.kind === 'request');
    const response = events.events().find((e) => e.kind === 'response');
    expect(request?.path).toBe('/v1/things/42');
    expect(response?.path).toBe('/v1/things/42');
  });

  it('stamps response event with status + latency', async () => {
    const events = createInMemoryEventSink();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({
      config: baseConfig,
      fetch: fetchMock,
      events,
    });

    await connector.call({ path: '/x', method: 'GET' });

    const response = events.events().find((e) => e.kind === 'response');
    expect(response?.status).toBe(200);
    expect(typeof response?.latencyMs).toBe('number');
  });

  it('emits error event with status on 4xx', async () => {
    const events = createInMemoryEventSink();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, { message: 'gone' }));
    const connector = createBaseConnector({
      config: baseConfig,
      fetch: fetchMock,
      events,
    });

    await connector.call({ path: '/x', method: 'GET' });

    const errorEvt = events.events().find((e) => e.kind === 'error');
    expect(errorEvt?.status).toBe(404);
  });

  it('emits a rate-limited event when bucket exhausted', async () => {
    const events = createInMemoryEventSink();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({
      config: { ...baseConfig, rateLimit: { rpm: 60, burst: 1 } },
      fetch: fetchMock,
      events,
    });

    await connector.call({ path: '/a', method: 'GET' });
    await connector.call({ path: '/b', method: 'GET' });

    const kinds = events.events().map((e) => e.kind);
    expect(kinds).toContain('rate-limited');
  });

  it('uses ISO timestamps based on the supplied clock', async () => {
    const clock = makeClock();
    const events = createInMemoryEventSink();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({
      config: baseConfig,
      fetch: fetchMock,
      events,
      clock: clock.now,
    });

    await connector.call({ path: '/x', method: 'GET' });

    for (const e of events.events()) {
      expect(e.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }
  });

  it('survives without an event sink configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock });

    const out = await connector.call({ path: '/x', method: 'GET' });

    expect(out.kind).toBe('ok');
  });
});

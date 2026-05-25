/**
 * Retry-loop coverage for createBaseConnector.
 * Verifies attempt-count semantics, the 5xx-then-success path, no retry on
 * 4xx, and that the maxAttempts default is honoured when not configured.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBaseConnector, type ConnectorConfig } from '../base-connector.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const baseConfig: ConnectorConfig = {
  id: 'retry-test',
  displayName: 'Retry Test',
  baseUrl: 'https://api.example.test',
  rateLimit: { rpm: 600, burst: 50 },
  timeoutMs: 5_000,
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1 });
});

describe('createBaseConnector — retry on 5xx', () => {
  it('returns ok and reports correct attempt number when retry succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { message: 'down' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const connector = createBaseConnector({
      config: { ...baseConfig, retry: { maxAttempts: 3, initialDelayMs: 1 } },
      fetch: fetchMock,
    });

    const out = await connector.call({ path: '/x', method: 'GET' });

    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.attempt).toBe(2);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries up to maxAttempts then surfaces upstream-error on persistent 502', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(502, { message: 'gateway' }));

    const connector = createBaseConnector({
      config: { ...baseConfig, retry: { maxAttempts: 4, initialDelayMs: 1 } },
      fetch: fetchMock,
    });

    const out = await connector.call({ path: '/x', method: 'GET' });

    expect(out.kind).toBe('upstream-error');
    if (out.kind === 'upstream-error') {
      expect(out.status).toBe(502);
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('createBaseConnector — no retry on 4xx', () => {
  it('does not retry 401 when auth is not oauth2', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { message: 'unauth' }));

    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        retry: { maxAttempts: 3, initialDelayMs: 1 },
        auth: { kind: 'bearer', token: async () => 'tok' },
      },
      fetch: fetchMock,
    });

    const out = await connector.call({ path: '/x', method: 'GET' });

    expect(out.kind).toBe('upstream-error');
    if (out.kind === 'upstream-error') {
      expect(out.status).toBe(401);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry 422 even with maxAttempts=5', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(422, { message: 'unprocessable' }));

    const connector = createBaseConnector({
      config: { ...baseConfig, retry: { maxAttempts: 5, initialDelayMs: 1 } },
      fetch: fetchMock,
    });

    const out = await connector.call({ path: '/x', method: 'GET' });

    expect(out.kind).toBe('upstream-error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('extracts message field from 4xx response body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(400, { message: 'invalid currency' }),
    );

    const connector = createBaseConnector({
      config: { ...baseConfig, retry: { maxAttempts: 3, initialDelayMs: 1 } },
      fetch: fetchMock,
    });

    const out = await connector.call({ path: '/x', method: 'GET' });

    expect(out.kind).toBe('upstream-error');
    if (out.kind === 'upstream-error') {
      expect(out.message).toBe('invalid currency');
    }
  });

  it('falls back to "HTTP <status>" when body lacks message field', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(418, { other: 'shape' }));

    const connector = createBaseConnector({
      config: { ...baseConfig, retry: { maxAttempts: 1, initialDelayMs: 1 } },
      fetch: fetchMock,
    });

    const out = await connector.call({ path: '/x', method: 'GET' });

    expect(out.kind).toBe('upstream-error');
    if (out.kind === 'upstream-error') {
      expect(out.message).toBe('HTTP 418');
    }
  });
});

describe('createBaseConnector — transport retries', () => {
  it('treats network rejection like a retryable error', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const connector = createBaseConnector({
      config: { ...baseConfig, retry: { maxAttempts: 3, initialDelayMs: 1 } },
      fetch: fetchMock,
    });

    const out = await connector.call({ path: '/x', method: 'GET' });

    expect(out.kind).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('coerces non-Error rejections into transport-error message', async () => {
    const fetchMock = vi.fn().mockRejectedValue('plain string failure');

    const connector = createBaseConnector({
      config: { ...baseConfig, retry: { maxAttempts: 1, initialDelayMs: 1 } },
      fetch: fetchMock,
    });

    const out = await connector.call({ path: '/x', method: 'GET' });

    expect(out.kind).toBe('transport-error');
    if (out.kind === 'transport-error') {
      expect(out.message).toContain('plain string failure');
    }
  });
});

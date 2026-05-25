/**
 * OAuth2 401-refresh edge cases for createBaseConnector.
 * Existing test only covers the happy path: 401 -> refresh -> retry -> ok.
 * Here we cover refresh failure, second-401 after refresh, and that
 * refresh is only attempted once per call (not per attempt).
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
  id: 'oauth-edge',
  displayName: 'OAuth Edge',
  baseUrl: 'https://api.example.test',
  rateLimit: { rpm: 600, burst: 50 },
  retry: { maxAttempts: 2, initialDelayMs: 1 },
  timeoutMs: 5_000,
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1 });
});

describe('createBaseConnector — oauth2 refresh failure', () => {
  it('returns transport-error when refresh() rejects', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('IdP down'));
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { message: 'expired' }));

    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        retry: { maxAttempts: 1, initialDelayMs: 1 },
        auth: {
          kind: 'oauth2',
          accessTokenProvider: async () => 'tok',
          refresh,
        },
      },
      fetch: fetchMock,
    });

    const out = await connector.call({ path: '/x', method: 'GET' });

    expect(out.kind).toBe('transport-error');
    if (out.kind === 'transport-error') {
      expect(out.message).toContain('IdP down');
    }
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('createBaseConnector — oauth2 401 still after refresh', () => {
  it('surfaces upstream-error when 401 persists after refresh', async () => {
    let token = 'stale';
    const refresh = vi.fn(async () => {
      token = 'still-bad';
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { message: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(401, { message: 'still expired' }));

    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        retry: { maxAttempts: 1, initialDelayMs: 1 },
        auth: {
          kind: 'oauth2',
          accessTokenProvider: async () => token,
          refresh,
        },
      },
      fetch: fetchMock,
    });

    const out = await connector.call({ path: '/x', method: 'GET' });

    expect(out.kind).toBe('upstream-error');
    if (out.kind === 'upstream-error') {
      expect(out.status).toBe(401);
    }
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('createBaseConnector — oauth2 refresh once per call', () => {
  it('does not invoke refresh again on a second 401 within the same call', async () => {
    let token = 'a';
    const refresh = vi.fn(async () => {
      token = 'b';
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { message: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(500, { message: 'now down' }))
      .mockResolvedValueOnce(jsonResponse(401, { message: 'expired again' }));

    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        retry: { maxAttempts: 3, initialDelayMs: 1 },
        auth: {
          kind: 'oauth2',
          accessTokenProvider: async () => token,
          refresh,
        },
      },
      fetch: fetchMock,
    });

    const out = await connector.call({ path: '/x', method: 'GET' });

    // Refresh fires only on the first 401
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(out.kind).toBe('upstream-error');
  });
});

describe('createBaseConnector — oauth2 401 -> refresh -> 5xx -> retry', () => {
  it('retries after refresh when retried-attempt returns 5xx', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { message: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(503, { message: 'down' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        retry: { maxAttempts: 2, initialDelayMs: 1 },
        auth: {
          kind: 'oauth2',
          accessTokenProvider: async () => 'tok',
          refresh,
        },
      },
      fetch: fetchMock,
    });

    const out = await connector.call({ path: '/x', method: 'GET' });

    expect(out.kind).toBe('ok');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

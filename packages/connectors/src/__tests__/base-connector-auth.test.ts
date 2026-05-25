/**
 * Auth-mode coverage for createBaseConnector — verifies api-key, basic, and
 * the headers the adapters actually exercise. Bearer + oauth2 happy paths
 * already covered in base-connector.test.ts; here we focus on the modes
 * that are otherwise untested, plus the no-auth default.
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
  id: 'auth-test',
  displayName: 'Auth Test',
  baseUrl: 'https://api.example.test',
  rateLimit: { rpm: 600, burst: 5 },
  retry: { maxAttempts: 1, initialDelayMs: 1 },
  timeoutMs: 5_000,
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1 });
});

function getHeaders(fetchMock: ReturnType<typeof vi.fn>): Record<string, string> {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return (init?.headers as Record<string, string>) ?? {};
}

describe('createBaseConnector — no auth', () => {
  it('does not set Authorization header by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock });

    await connector.call({ path: '/x', method: 'GET' });

    expect(getHeaders(fetchMock).Authorization).toBeUndefined();
  });
});

describe('createBaseConnector — api-key auth', () => {
  it('sets configured header name with the supplied key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        auth: { kind: 'api-key', headerName: 'X-API-Key', key: 'secret-123' },
      },
      fetch: fetchMock,
    });

    await connector.call({ path: '/x', method: 'GET' });

    expect(getHeaders(fetchMock)['X-API-Key']).toBe('secret-123');
  });

  it('uses an alternate header name when configured (e.g., X-Auth-Token)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        auth: { kind: 'api-key', headerName: 'X-Auth-Token', key: 'tok' },
      },
      fetch: fetchMock,
    });

    await connector.call({ path: '/x', method: 'GET' });

    const headers = getHeaders(fetchMock);
    expect(headers['X-Auth-Token']).toBe('tok');
    expect(headers['X-API-Key']).toBeUndefined();
  });
});

describe('createBaseConnector — basic auth', () => {
  it('sets Authorization: Basic with base64-encoded credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        auth: { kind: 'basic', username: 'alice', password: 'wonderland' },
      },
      fetch: fetchMock,
    });

    await connector.call({ path: '/x', method: 'GET' });

    const expected = `Basic ${Buffer.from('alice:wonderland', 'utf8').toString('base64')}`;
    expect(getHeaders(fetchMock).Authorization).toBe(expected);
  });

  it('handles credentials containing colon-bearing passwords', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        auth: { kind: 'basic', username: 'user', password: 'a:b:c' },
      },
      fetch: fetchMock,
    });

    await connector.call({ path: '/x', method: 'GET' });

    const expected = `Basic ${Buffer.from('user:a:b:c', 'utf8').toString('base64')}`;
    expect(getHeaders(fetchMock).Authorization).toBe(expected);
  });
});

describe('createBaseConnector — oauth2 access token only', () => {
  it('sets Authorization: Bearer using the token provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const refresh = vi.fn();
    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        auth: {
          kind: 'oauth2',
          accessTokenProvider: async () => 'access-xyz',
          refresh,
        },
      },
      fetch: fetchMock,
    });

    await connector.call({ path: '/x', method: 'GET' });

    expect(getHeaders(fetchMock).Authorization).toBe('Bearer access-xyz');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not refresh on 4xx other than 401', async () => {
    const refresh = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(403, { message: 'forbidden' }));

    const connector = createBaseConnector({
      config: {
        ...baseConfig,
        auth: {
          kind: 'oauth2',
          accessTokenProvider: async () => 'tok',
          refresh,
        },
      },
      fetch: fetchMock,
    });

    const out = await connector.call({ path: '/x', method: 'GET' });

    expect(out.kind).toBe('upstream-error');
    expect(refresh).not.toHaveBeenCalled();
  });
});

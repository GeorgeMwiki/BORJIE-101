/**
 * Coverage for the URL builder + query-string handling inside the base
 * connector. Verifies trailing-slash, leading-slash, undefined-skipping,
 * and value encoding.
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
  id: 'url-test',
  displayName: 'URL Test',
  baseUrl: 'https://api.example.test',
  retry: { maxAttempts: 1, initialDelayMs: 1 },
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1 });
});

function urlOf(fetchMock: ReturnType<typeof vi.fn>): string {
  return fetchMock.mock.calls[0]?.[0] as string;
}

describe('createBaseConnector — URL building', () => {
  it('joins base + path correctly when path has leading slash', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock });

    await connector.call({ path: '/v1/items', method: 'GET' });

    expect(urlOf(fetchMock)).toBe('https://api.example.test/v1/items');
  });

  it('joins base + path correctly when path has no leading slash', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock });

    await connector.call({ path: 'v1/items', method: 'GET' });

    expect(urlOf(fetchMock)).toBe('https://api.example.test/v1/items');
  });

  it('strips trailing slash on base URL before appending path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({
      config: { ...baseConfig, baseUrl: 'https://api.example.test/' },
      fetch: fetchMock,
    });

    await connector.call({ path: '/v1/items', method: 'GET' });

    expect(urlOf(fetchMock)).toBe('https://api.example.test/v1/items');
  });
});

describe('createBaseConnector — query strings', () => {
  it('appends a single query parameter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock });

    await connector.call({ path: '/x', method: 'GET', query: { page: 2 } });

    expect(urlOf(fetchMock)).toBe('https://api.example.test/x?page=2');
  });

  it('appends multiple query parameters joined by &', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock });

    await connector.call({
      path: '/x',
      method: 'GET',
      query: { page: 1, size: 50 },
    });

    expect(urlOf(fetchMock)).toContain('page=1');
    expect(urlOf(fetchMock)).toContain('size=50');
    expect(urlOf(fetchMock)).toContain('?');
  });

  it('skips undefined query parameter values', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock });

    await connector.call({
      path: '/x',
      method: 'GET',
      query: { page: 1, cursor: undefined },
    });

    const url = urlOf(fetchMock);
    expect(url).toContain('page=1');
    expect(url).not.toContain('cursor=');
  });

  it('omits "?" when all query values are undefined', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock });

    await connector.call({
      path: '/x',
      method: 'GET',
      query: { a: undefined, b: undefined },
    });

    expect(urlOf(fetchMock)).toBe('https://api.example.test/x');
  });

  it('URL-encodes parameter keys and values', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock });

    await connector.call({
      path: '/search',
      method: 'GET',
      query: { 'q&filter': 'hello world' },
    });

    const url = urlOf(fetchMock);
    expect(url).toContain('q%26filter=hello%20world');
  });

  it('coerces numeric values to strings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock });

    await connector.call({
      path: '/x',
      method: 'GET',
      query: { count: 42 },
    });

    expect(urlOf(fetchMock)).toContain('count=42');
  });
});

describe('createBaseConnector — custom headers', () => {
  it('merges custom request headers with content/accept defaults', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock });

    await connector.call({
      path: '/x',
      method: 'GET',
      headers: { 'X-Trace-Id': 't-1' },
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string>;
    expect(headers['X-Trace-Id']).toBe('t-1');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Accept']).toBe('application/json');
  });
});

describe('createBaseConnector — body serialisation', () => {
  it('omits body for GET requests when none provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock });

    await connector.call({ path: '/x', method: 'GET' });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.body).toBeUndefined();
  });

  it('serialises POST body as JSON string', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock });

    await connector.call({
      path: '/x',
      method: 'POST',
      body: { a: 1, b: 'two' },
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.body).toBe(JSON.stringify({ a: 1, b: 'two' }));
  });
});

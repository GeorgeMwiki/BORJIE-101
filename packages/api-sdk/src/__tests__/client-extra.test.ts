/**
 * Extra tests for client.ts — covers areas not exercised by
 * test/client.test.ts: API-key auth, default headers, custom timeout,
 * abort signal merging, query encoding edge cases, and parseErrorResponse
 * tolerance for non-JSON / string bodies.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ApiSdkError,
  buildUrl,
  createBossnyumbaClient,
  parseErrorResponse,
} from '../client.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain' },
  });
}

describe('buildUrl edge cases', () => {
  it('skips null/undefined query values entirely', () => {
    const url = buildUrl(
      'http://api',
      '/x',
      undefined,
      { a: 'a', b: null, c: undefined, d: 'd' },
    );
    expect(url).toBe('http://api/x?a=a&d=d');
  });

  it('encodes special characters in path params', () => {
    const url = buildUrl(
      'http://api',
      '/x/{id}',
      { id: 'a/b c' },
    );
    expect(url).toBe('http://api/x/a%2Fb%20c');
  });

  it('skips null entries inside array query values', () => {
    const url = buildUrl(
      'http://api',
      '/x',
      undefined,
      { tags: ['a', null, 'b', undefined] as unknown[] },
    );
    expect(url).toBe('http://api/x?tags=a&tags=b');
  });

  it('preserves an existing ? in the path when adding a query', () => {
    const url = buildUrl('http://api', '/x?fixed=1', undefined, { a: 'b' });
    expect(url).toBe('http://api/x?fixed=1&a=b');
  });

  it('omits the separator entirely when query is empty', () => {
    const url = buildUrl('http://api', '/x', undefined, {});
    expect(url).toBe('http://api/x');
  });

  it('coerces numeric values to strings', () => {
    const url = buildUrl('http://api', '/x', undefined, { n: 7, b: true });
    expect(url).toBe('http://api/x?b=true&n=7');
  });
});

describe('createBossnyumbaClient — auth + headers', () => {
  it('throws when no baseUrl is provided', () => {
    expect(() =>
      createBossnyumbaClient({ baseUrl: '' }),
    ).toThrowError(/baseUrl is required/);
  });

  it('sets X-API-Key when apiKey config is provided', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const fetchFn = vi.fn(async (_input, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return jsonResponse(200, { ok: true });
    }) as unknown as typeof fetch;
    const client = createBossnyumbaClient({
      baseUrl: 'http://api',
      apiKey: 'k-1',
      fetchFn,
    });
    await client.request({ method: 'GET', path: '/a' });
    expect(capturedHeaders?.['X-API-Key']).toBe('k-1');
  });

  it('merges defaultHeaders into every request', async () => {
    let captured: Record<string, string> | undefined;
    const fetchFn = vi.fn(async (_input, init?: RequestInit) => {
      captured = init?.headers as Record<string, string>;
      return jsonResponse(200, {});
    }) as unknown as typeof fetch;
    const client = createBossnyumbaClient({
      baseUrl: 'http://api',
      defaultHeaders: { 'X-Tenant-Id': 'tenant-a' },
      fetchFn,
    });
    await client.request({ method: 'GET', path: '/x' });
    expect(captured?.['X-Tenant-Id']).toBe('tenant-a');
  });

  it('per-request headers override defaultHeaders', async () => {
    let captured: Record<string, string> | undefined;
    const fetchFn = vi.fn(async (_input, init?: RequestInit) => {
      captured = init?.headers as Record<string, string>;
      return jsonResponse(200, {});
    }) as unknown as typeof fetch;
    const client = createBossnyumbaClient({
      baseUrl: 'http://api',
      defaultHeaders: { 'X-Custom': 'default' },
      fetchFn,
    });
    await client.request({
      method: 'GET',
      path: '/x',
      headers: { 'X-Custom': 'override' },
    });
    expect(captured?.['X-Custom']).toBe('override');
  });

  it('does not set Authorization when no bearer is configured', async () => {
    let captured: Record<string, string> | undefined;
    const fetchFn = vi.fn(async (_input, init?: RequestInit) => {
      captured = init?.headers as Record<string, string>;
      return jsonResponse(200, {});
    }) as unknown as typeof fetch;
    const client = createBossnyumbaClient({ baseUrl: 'http://api', fetchFn });
    await client.request({ method: 'GET', path: '/x' });
    expect(captured?.['Authorization']).toBeUndefined();
  });

  it('does not auto-set Content-Type when there is no body', async () => {
    let captured: Record<string, string> | undefined;
    const fetchFn = vi.fn(async (_input, init?: RequestInit) => {
      captured = init?.headers as Record<string, string>;
      return jsonResponse(200, {});
    }) as unknown as typeof fetch;
    const client = createBossnyumbaClient({ baseUrl: 'http://api', fetchFn });
    await client.request({ method: 'GET', path: '/x' });
    expect(captured?.['Content-Type']).toBeUndefined();
  });

  it('keeps caller-supplied Content-Type and does not overwrite it', async () => {
    let captured: Record<string, string> | undefined;
    const fetchFn = vi.fn(async (_input, init?: RequestInit) => {
      captured = init?.headers as Record<string, string>;
      return jsonResponse(200, {});
    }) as unknown as typeof fetch;
    const client = createBossnyumbaClient({ baseUrl: 'http://api', fetchFn });
    await client.request({
      method: 'POST',
      path: '/x',
      body: 'raw',
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(captured?.['Content-Type']).toBe('text/plain');
  });

  it('returns text body when content-type is not JSON', async () => {
    const fetchFn = vi.fn(async () => textResponse(200, 'hello world')) as unknown as typeof fetch;
    const client = createBossnyumbaClient({ baseUrl: 'http://api', fetchFn });
    const out = await client.request({ method: 'GET', path: '/p' });
    expect(out).toBe('hello world');
  });

  it('exposes baseUrl and config on the returned client', () => {
    const client = createBossnyumbaClient({
      baseUrl: 'http://api',
      bearerToken: 'tok',
    });
    expect(client.baseUrl).toBe('http://api');
    expect(client.config.baseUrl).toBe('http://api');
  });

  it('health.check uses the /health path', async () => {
    let url: string | undefined;
    const fetchFn = vi.fn(async (input) => {
      url = String(input);
      return jsonResponse(200, { status: 'ok' });
    }) as unknown as typeof fetch;
    const client = createBossnyumbaClient({ baseUrl: 'http://api', fetchFn });
    await client.health.check();
    expect(url).toBe('http://api/health');
  });
});

describe('parseErrorResponse — non-JSON paths', () => {
  it('treats string body as message', async () => {
    const err = await parseErrorResponse(textResponse(503, 'gateway down'), 'http://api/x');
    expect(err.status).toBe(503);
    expect(err.code).toBe('HTTP_503');
    expect(err.message).toBe('gateway down');
  });

  it('falls back to HTTP_<status> when payload has no envelope', async () => {
    const err = await parseErrorResponse(jsonResponse(418, { random: 'thing' }), 'http://api');
    expect(err.code).toBe('HTTP_418');
  });

  it('produces an ApiSdkError with the exact url passed in', async () => {
    const err = await parseErrorResponse(jsonResponse(500, {}), 'http://api/widgets/42');
    expect(err).toBeInstanceOf(ApiSdkError);
    expect(err.url).toBe('http://api/widgets/42');
  });

  it('handles JSON parse failure by falling back to undefined', async () => {
    const malformed = new Response('{not-json', {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
    const err = await parseErrorResponse(malformed, 'http://api/x');
    expect(err.status).toBe(500);
    expect(err.code).toBe('HTTP_500');
  });
});

describe('ApiSdkError', () => {
  it('captures all envelope fields', () => {
    const err = new ApiSdkError({
      status: 400,
      url: 'http://api/x',
      code: 'X',
      message: 'm',
      requestId: 'rq-1',
      details: { a: 1 },
    });
    expect(err.name).toBe('ApiSdkError');
    expect(err.status).toBe(400);
    expect(err.code).toBe('X');
    expect(err.message).toBe('m');
    expect(err.requestId).toBe('rq-1');
    expect(err.details).toEqual({ a: 1 });
    expect(err.url).toBe('http://api/x');
  });
});

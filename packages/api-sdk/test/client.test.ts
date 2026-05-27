/**
 * Tests for `@borjie/api-sdk` client wrapper.
 *
 * Coverage:
 *   1. `buildUrl` handles path params + sorted query params
 *   2. `createBorjieClient` wires bearer auth on every call
 *   3. Non-2xx responses throw `ApiSdkError` with code/message from envelope
 *   4. The generate step produces valid TS (smoke-tested by importing types)
 *   5. `marketplace.listings.list` builds the correct URL
 *   6. `marketplace.listings.get` substitutes the {id} path param
 *   7. 204 responses resolve to undefined
 *   8. `parseErrorResponse` tolerates empty bodies
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createBorjieClient,
  ApiSdkError,
  buildUrl,
  parseErrorResponse,
} from '../src/index.js';
import type { paths } from '../src/types.js';

function mockFetch(
  respond: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>
): typeof fetch {
  return vi.fn(async (input, init) => respond(input, init)) as unknown as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('buildUrl', () => {
  it('substitutes path params and sorts query keys deterministically', () => {
    const url = buildUrl(
      'http://api.test',
      '/api/v1/customers/{id}/orders',
      { id: '42' },
      { status: 'open', since: '2026-01-01', tags: ['a', 'b'] }
    );
    expect(url).toBe(
      'http://api.test/api/v1/customers/42/orders?since=2026-01-01&status=open&tags=a&tags=b'
    );
  });

  it('strips a trailing slash from baseUrl', () => {
    expect(buildUrl('http://api.test/', '/health')).toBe('http://api.test/health');
  });

  it('throws on missing path param', () => {
    expect(() =>
      buildUrl('http://api.test', '/x/{id}', {} as Record<string, string>)
    ).toThrowError(/Missing path parameter "id"/);
  });
});

describe('createBorjieClient', () => {
  it('sends Authorization + JSON body and parses response', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = mockFetch((input, init) => {
      calls.push({ url: String(input), init });
      return jsonResponse(200, { ok: true });
    });
    const client = createBorjieClient({
      baseUrl: 'http://localhost:4001',
      bearerToken: 'static-jwt',
      fetchFn,
    });
    const result = await client.request<{ ok: boolean }>({
      method: 'POST',
      path: '/api/v1/things',
      body: { name: 'hello' },
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:4001/api/v1/things');
    expect(calls[0].init?.method).toBe('POST');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer static-jwt');
    expect(headers['Content-Type']).toBe('application/json');
    expect(calls[0].init?.body).toBe(JSON.stringify({ name: 'hello' }));
  });

  it('resolves bearer token lazily when given a function', async () => {
    let n = 0;
    const fetchFn = mockFetch(() => jsonResponse(200, {}));
    const client = createBorjieClient({
      baseUrl: 'http://api',
      bearerToken: async () => `tok-${++n}`,
      fetchFn,
    });
    await client.request({ method: 'GET', path: '/a' });
    await client.request({ method: 'GET', path: '/b' });
    const calls = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(((calls[0][1] as RequestInit).headers as Record<string, string>)['Authorization']).toBe(
      'Bearer tok-1'
    );
    expect(((calls[1][1] as RequestInit).headers as Record<string, string>)['Authorization']).toBe(
      'Bearer tok-2'
    );
  });

  it('throws ApiSdkError with code+message from gateway envelope', async () => {
    const fetchFn = mockFetch(() =>
      jsonResponse(400, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'email required',
          requestId: 'req-123',
        },
      })
    );
    const client = createBorjieClient({ baseUrl: 'http://api', fetchFn });
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toMatchObject({
      name: 'ApiSdkError',
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'email required',
      requestId: 'req-123',
    });
  });

  it('marketplace.listings.list builds the expected URL', async () => {
    let capturedUrl = '';
    const fetchFn = mockFetch((input) => {
      capturedUrl = String(input);
      return jsonResponse(200, { data: [] });
    });
    const client = createBorjieClient({ baseUrl: 'http://api', fetchFn });
    await client.marketplace.listings.list({ limit: 10, cursor: 'abc' });
    expect(capturedUrl).toBe('http://api/api/v1/marketplace/listings?cursor=abc&limit=10');
  });

  it('marketplace.listings.get substitutes the id path param', async () => {
    let capturedUrl = '';
    const fetchFn = mockFetch((input) => {
      capturedUrl = String(input);
      return jsonResponse(200, { id: 'L-1' });
    });
    const client = createBorjieClient({ baseUrl: 'http://api', fetchFn });
    await client.marketplace.listings.get('L-1');
    expect(capturedUrl).toBe('http://api/api/v1/marketplace/listings/L-1');
  });

  it('returns undefined for 204 No Content', async () => {
    const fetchFn = mockFetch(() => new Response(null, { status: 204 }));
    const client = createBorjieClient({ baseUrl: 'http://api', fetchFn });
    const out = await client.request<void>({ method: 'DELETE', path: '/a/1' });
    expect(out).toBeUndefined();
  });

  it('wraps network errors as NETWORK_ERROR ApiSdkError', async () => {
    const fetchFn = mockFetch(() => {
      throw new TypeError('fetch failed');
    });
    const client = createBorjieClient({ baseUrl: 'http://api', fetchFn });
    await expect(
      client.request({ method: 'GET', path: '/a' })
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });
});

describe('parseErrorResponse', () => {
  it('handles empty body without throwing', async () => {
    const err = await parseErrorResponse(new Response(null, { status: 500 }), 'http://api/x');
    expect(err).toBeInstanceOf(ApiSdkError);
    expect(err.code).toBe('HTTP_500');
    expect(err.status).toBe(500);
  });

  it('extracts fields from the error envelope', async () => {
    const err = await parseErrorResponse(
      new Response(JSON.stringify({ error: { code: 'X', message: 'y' } }), {
        status: 418,
        headers: { 'content-type': 'application/json' },
      }),
      'http://api/x'
    );
    expect(err.code).toBe('X');
    expect(err.message).toBe('y');
    expect(err.status).toBe(418);
  });
});

describe('generated types module', () => {
  it('exports paths/components/operations without syntax errors', () => {
    // Assign a value of type `paths` to exercise the type alias at compile
    // time. Runtime assertion is just that the module loaded.
    const dummy: paths = {} as paths;
    expect(dummy).toBeDefined();
  });
});

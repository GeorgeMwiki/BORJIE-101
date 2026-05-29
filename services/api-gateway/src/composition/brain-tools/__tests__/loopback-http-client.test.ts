/**
 * Loopback HTTP client tests — REALITY_CHECK G-A.
 *
 * Verifies that the persona-tool catalog's HTTP-client gap (gate.httpClient
 * was never bound, so every handler fell back to fake data) is properly
 * closed:
 *
 *   1. createLoopbackHttpClient builds a client that mints HS256 service
 *      tokens with the tenant + actor identity threaded through
 *      AsyncLocalStorage (no per-call signature change required).
 *   2. The client unwraps `{ success: true, data: {...} }` envelopes —
 *      most owner-portal handlers wrap their payload this way.
 *   3. The client falls through plain JSON when the envelope is absent.
 *   4. Non-2xx upstream responses throw a structured Error.
 *   5. Missing AsyncLocalStorage context throws — handlers MUST call
 *      runWithLoopbackContext() (which the toBrainToolHandler adapter
 *      now does automatically).
 *   6. runWithLoopbackContext correctly threads through nested async
 *      boundaries.
 *
 * The fetch impl is stubbed so this is a pure unit test — no network.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createLoopbackHttpClient,
  runWithLoopbackContext,
  getLoopbackContext,
} from '../loopback-http-client';

const TEST_SECRET = 'x'.repeat(40); // ≥32 chars

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly bodyText: string | null;
}

function makeFakeFetch(
  response: { status: number; body: unknown } | Error,
): { fetchImpl: typeof fetch; captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
    const req = new Request(input as string, init);
    const bodyText = init?.body ? String(init.body) : null;
    captured.push({
      url: req.url,
      method: req.method,
      headers: new Headers(init?.headers),
      bodyText,
    });
    if (response instanceof Error) throw response;
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, captured };
}

describe('createLoopbackHttpClient', () => {
  it('mints a service JWT with tenant + actor from AsyncLocalStorage', async () => {
    const { fetchImpl, captured } = makeFakeFetch({
      status: 200,
      body: { success: true, data: { ok: 1 } },
    });
    const client = createLoopbackHttpClient({
      origin: 'http://127.0.0.1:4001',
      apiPrefix: '/api/v1',
      jwtSecret: TEST_SECRET,
      fetchImpl,
    });

    const result = await runWithLoopbackContext(
      { tenantId: 'demo-tenant', actorId: 'usr_owner_1' },
      () => client.get<{ ok: number }>('/owner/share-links'),
    );

    expect(result).toEqual({ ok: 1 });
    expect(captured).toHaveLength(1);
    const auth = captured[0]?.headers.get('authorization') ?? '';
    expect(auth).toMatch(/^Bearer eyJ/); // jose-signed JWT
    expect(captured[0]?.url).toBe(
      'http://127.0.0.1:4001/api/v1/owner/share-links',
    );
    expect(captured[0]?.headers.get('x-borjie-loopback')).toBe('1');
  });

  it('unwraps { success, data } envelope', async () => {
    const { fetchImpl } = makeFakeFetch({
      status: 200,
      body: { success: true, data: { foo: 'bar' } },
    });
    const client = createLoopbackHttpClient({
      origin: 'http://127.0.0.1:4001',
      apiPrefix: '/api/v1',
      jwtSecret: TEST_SECRET,
      fetchImpl,
      resolveContext: () => ({ tenantId: 't', actorId: 'a' }),
    });
    const got = await client.get<{ foo: string }>('/owner/pinned-items');
    expect(got).toEqual({ foo: 'bar' });
  });

  it('falls through plain JSON when no envelope', async () => {
    const { fetchImpl } = makeFakeFetch({
      status: 200,
      body: { count: 42 },
    });
    const client = createLoopbackHttpClient({
      origin: 'http://127.0.0.1:4001',
      apiPrefix: '/api/v1',
      jwtSecret: TEST_SECRET,
      fetchImpl,
      resolveContext: () => ({ tenantId: 't', actorId: 'a' }),
    });
    const got = await client.get<{ count: number }>('/raw');
    expect(got).toEqual({ count: 42 });
  });

  it('throws on non-2xx upstream', async () => {
    const { fetchImpl } = makeFakeFetch({
      status: 404,
      body: { error: 'not found' },
    });
    const warns: Array<{ ctx: unknown; msg: string }> = [];
    const client = createLoopbackHttpClient({
      origin: 'http://127.0.0.1:4001',
      apiPrefix: '/api/v1',
      jwtSecret: TEST_SECRET,
      fetchImpl,
      resolveContext: () => ({ tenantId: 't', actorId: 'a' }),
      logger: {
        warn: (ctx, msg): void => {
          warns.push({ ctx, msg });
        },
      },
    });
    await expect(client.get('/missing')).rejects.toThrow(/404/);
    expect(warns).toHaveLength(1);
    expect(warns[0]?.msg).toMatch(/non-2xx/);
  });

  it('throws when AsyncLocalStorage context is not bound', async () => {
    const { fetchImpl } = makeFakeFetch({
      status: 200,
      body: {},
    });
    const client = createLoopbackHttpClient({
      origin: 'http://127.0.0.1:4001',
      apiPrefix: '/api/v1',
      jwtSecret: TEST_SECRET,
      fetchImpl,
    });
    await expect(client.get('/owner/share-links')).rejects.toThrow(
      /no AsyncLocalStorage context bound/,
    );
  });

  it('POST body is JSON-serialised; auth + content-type set', async () => {
    const { fetchImpl, captured } = makeFakeFetch({
      status: 201,
      body: { success: true, data: { id: 'abc' } },
    });
    const client = createLoopbackHttpClient({
      origin: 'http://127.0.0.1:4001',
      apiPrefix: '/api/v1',
      jwtSecret: TEST_SECRET,
      fetchImpl,
      resolveContext: () => ({ tenantId: 't', actorId: 'a' }),
    });
    const result = await client.post<{ id: string }>(
      '/owner/share-links',
      { resource: 'brief', expiresInDays: 7 },
    );
    expect(result).toEqual({ id: 'abc' });
    expect(captured[0]?.method).toBe('POST');
    expect(captured[0]?.headers.get('content-type')).toBe(
      'application/json',
    );
    expect(JSON.parse(captured[0]?.bodyText ?? '{}')).toEqual({
      resource: 'brief',
      expiresInDays: 7,
    });
  });

  it('threads AsyncLocalStorage through nested async boundaries', async () => {
    const ctxSeenInside = await runWithLoopbackContext(
      { tenantId: 'tenant-A', actorId: 'actor-1' },
      async () => {
        await Promise.resolve();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        return getLoopbackContext();
      },
    );
    expect(ctxSeenInside).toEqual({
      tenantId: 'tenant-A',
      actorId: 'actor-1',
    });
  });

  it('encodes query parameters with proper escaping', async () => {
    const { fetchImpl, captured } = makeFakeFetch({
      status: 200,
      body: { success: true, data: [] },
    });
    const client = createLoopbackHttpClient({
      origin: 'http://127.0.0.1:4001',
      apiPrefix: '/api/v1',
      jwtSecret: TEST_SECRET,
      fetchImpl,
      resolveContext: () => ({ tenantId: 't', actorId: 'a' }),
    });
    await client.get('/mining/tasks', {
      query: { status: 'open', siteId: 'site/1?2', limit: 10 },
    });
    const u = new URL(captured[0]?.url ?? '');
    expect(u.searchParams.get('status')).toBe('open');
    expect(u.searchParams.get('siteId')).toBe('site/1?2');
    expect(u.searchParams.get('limit')).toBe('10');
  });
});

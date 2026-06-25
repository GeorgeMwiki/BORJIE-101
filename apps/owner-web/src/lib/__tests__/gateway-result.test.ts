/**
 * Substrate test for the typed gateway-fetch result.
 *
 * These cases are the BARRIER that keeps FAILURE distinguishable from
 * EMPTINESS (and from SUCCESS). If `gatewayFetch` ever folds a failure back
 * into the success branch (or a bare null), the three caller-side bugs this
 * substrate was built to kill — fake-empty estate, failed-write-shows-success
 * — silently return. Each test below pins one failure class.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { gatewayFetch, unwrapEnvelope } from '../gateway-result';

const URL = 'https://gw.example/api/v1/thing';
const PATH = '/api/v1/thing';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('unwrapEnvelope', () => {
  it('unwraps the { success, data } envelope', () => {
    expect(unwrapEnvelope({ success: true, data: { n: 1 } })).toEqual({ n: 1 });
  });

  it('returns a bare payload verbatim when there is no envelope', () => {
    expect(unwrapEnvelope([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe('gatewayFetch — success', () => {
  it('returns ok:true with the unwrapped data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: { sites: [] } })),
    );
    const result = await gatewayFetch<{ sites: unknown[] }>({ url: URL, path: PATH });
    expect(result).toEqual({ ok: true, data: { sites: [] } });
  });

  it('an EMPTY-but-valid payload is ok:true, never a failure', async () => {
    // The crux: an empty array is EMPTINESS, not FAILURE — it must be ok:true
    // so the caller never paints a "could not load" over a genuinely empty
    // estate, and never a failure over an empty list.
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: true, data: [] })));
    const result = await gatewayFetch<unknown[]>({ url: URL, path: PATH });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
  });
});

describe('gatewayFetch — failure classes are distinct', () => {
  it('network rejection → kind:network, logged once', async () => {
    const log = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const result = await gatewayFetch({ url: URL, path: PATH, log });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('network');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[1]).toMatchObject({ path: PATH, kind: 'network' });
  });

  it('non-2xx → kind:http with the status, logged once', async () => {
    const log = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'nope' }, 503)));
    const result = await gatewayFetch({ url: URL, path: PATH, log });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('http');
      expect(result.status).toBe(503);
    }
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[1]).toMatchObject({ kind: 'http', status: 503 });
  });

  it('2xx with unparseable body → kind:parse, logged once', async () => {
    const log = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<<<not json>>>', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    const result = await gatewayFetch({ url: URL, path: PATH, log });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('parse');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[1]).toMatchObject({ kind: 'parse', status: 200 });
  });

  it('204 No Content is a success, not a parse failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    const result = await gatewayFetch({ url: URL, path: PATH });
    expect(result.ok).toBe(true);
  });

  it('never throws and never logs on the success path', async () => {
    const log = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: true, data: 1 })));
    const result = await gatewayFetch<number>({ url: URL, path: PATH, log });
    expect(result.ok).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });
});

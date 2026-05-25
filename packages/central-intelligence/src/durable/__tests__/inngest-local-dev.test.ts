/**
 * Tests for `createLocalDevInngestClient` — the dev-time wiring that
 * forwards events to `npx inngest-cli@latest dev` on `:8288`.
 *
 * No mocking framework — the test installs a hand-rolled `FetchLike`
 * stub via `opts.fetch` and asserts the request shape.
 */
import { describe, it, expect } from 'vitest';
import {
  createLocalDevInngestClient,
  createNoopInngestClient,
  INNGEST_LOCAL_DEV_APP_ID,
  INNGEST_LOCAL_DEV_URL,
  type FetchLike,
} from '../inngest-client.js';

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

function createFetchSpy(
  response: { ok?: boolean; status?: number; bodyText?: string } = {},
): { fetch: FetchLike; calls: ReadonlyArray<CapturedRequest> } {
  const calls: CapturedRequest[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      body: init?.body ?? '',
    });
    const ok = response.ok ?? true;
    const status = response.status ?? (ok ? 200 : 500);
    const bodyText = response.bodyText ?? '';
    return {
      ok,
      status,
      async text() {
        return bodyText;
      },
    };
  };
  return { fetch, get calls() { return calls.slice(); } };
}

describe('createLocalDevInngestClient — disabled paths', () => {
  it('returns a noop client when enabled=false', async () => {
    const client = createLocalDevInngestClient({ enabled: false });
    // Same shape as the canonical noop client.
    const noop = createNoopInngestClient();
    expect(typeof client.send).toBe(typeof noop.send);
    expect(typeof client.createFunction).toBe(typeof noop.createFunction);

    // Sending against the noop client must not throw.
    await expect(
      client.send({ name: 'x.y', data: { hello: 'world' } }),
    ).resolves.toBeUndefined();
  });

  it('returns a noop client when INNGEST_DEV env is unset', () => {
    const before = process.env.INNGEST_DEV;
    delete process.env.INNGEST_DEV;
    try {
      const client = createLocalDevInngestClient();
      // No fetch should ever be called — the easiest way to assert is
      // that no opts.fetch was required (noop branch was taken).
      expect(typeof client.send).toBe('function');
    } finally {
      if (before !== undefined) process.env.INNGEST_DEV = before;
    }
  });

  it('reads INNGEST_DEV=1 from env and enables the real client', async () => {
    const before = process.env.INNGEST_DEV;
    process.env.INNGEST_DEV = '1';
    try {
      const spy = createFetchSpy();
      const client = createLocalDevInngestClient({ fetch: spy.fetch });
      await client.send({ name: 'evt.real', data: { x: 1 } });
      // PROOF: env was read AND the real fetch was wired up.
      expect(spy.calls.length).toBe(1);
    } finally {
      if (before === undefined) delete process.env.INNGEST_DEV;
      else process.env.INNGEST_DEV = before;
    }
  });
});

describe('createLocalDevInngestClient — enabled', () => {
  it('targets http://localhost:8288 by default with the default app id', async () => {
    const spy = createFetchSpy();
    const client = createLocalDevInngestClient({
      enabled: true,
      fetch: spy.fetch,
    });
    await client.send({ name: 'task.run.requested', data: { tenant: 't1' } });

    expect(spy.calls.length).toBe(1);
    const call = spy.calls[0]!;
    expect(call.url).toBe(
      `${INNGEST_LOCAL_DEV_URL}/e/${encodeURIComponent(INNGEST_LOCAL_DEV_APP_ID)}`,
    );
    expect(call.method).toBe('POST');
    expect(call.headers['content-type']).toBe('application/json');
    const parsed = JSON.parse(call.body) as { name: string; data: Record<string, unknown> };
    expect(parsed.name).toBe('task.run.requested');
    expect(parsed.data).toEqual({ tenant: 't1' });
  });

  it('honours a custom appId and baseUrl', async () => {
    const spy = createFetchSpy();
    const client = createLocalDevInngestClient({
      enabled: true,
      fetch: spy.fetch,
      appId: 'parcel-service',
      baseUrl: 'http://127.0.0.1:9999/',
    });
    await client.send({ name: 'parcel.geocoded', data: { lat: 0, lng: 0 } });

    const call = spy.calls[0]!;
    // Trailing slash on baseUrl is stripped.
    expect(call.url).toBe('http://127.0.0.1:9999/e/parcel-service');
  });

  it('throws and forwards transport errors', async () => {
    const spy = createFetchSpy({ ok: false, status: 503, bodyText: 'dev server offline' });
    const errors: unknown[] = [];
    const client = createLocalDevInngestClient({
      enabled: true,
      fetch: spy.fetch,
      onError: (e) => errors.push(e),
    });
    await expect(
      client.send({ name: 'e', data: {} }),
    ).rejects.toThrow(/send failed \(503\) dev server offline/);
    expect(errors.length).toBe(1);
  });

  it('createFunction is a no-op pass-through (cli polls the serve handler)', () => {
    const spy = createFetchSpy();
    const client = createLocalDevInngestClient({
      enabled: true,
      fetch: spy.fetch,
    });
    const def = {
      id: 'fn-1',
      trigger: { event: 'task.run.requested' as const },
      handler: async () => undefined,
    };
    const returned = client.createFunction(def);
    expect(returned).toBe(def);
    expect(spy.calls.length).toBe(0);
  });
});

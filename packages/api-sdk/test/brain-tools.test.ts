import { describe, expect, it, vi } from 'vitest';
import { createBorjieClient, createBrainTools } from '../src/index.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init ?? {}),
  ) as unknown as typeof fetch;
  return {
    fetchFn,
    client: createBorjieClient({
      baseUrl: 'http://api.test',
      bearerToken: 'tok_abc',
      fetchFn,
    }),
  };
}

describe('createBrainTools', () => {
  it('exposes every documented client', () => {
    const { client } = makeClient(() => jsonResponse(200, {}));
    const tools = createBrainTools(client);
    for (const k of [
      'chat',
      'drafts',
      'estate',
      'compliance',
      'opportunities',
      'risks',
      'decisions',
      'entities',
      'reminders',
      'share',
      'bulk',
      'undo',
      'scope',
    ] as const) {
      expect(tools[k]).toBeDefined();
    }
  });

  it('drafts.list hits GET /api/v1/owner/drafts with Bearer auth', async () => {
    const { fetchFn, client } = makeClient(() => jsonResponse(200, { data: [] }));
    const tools = createBrainTools(client);
    await tools.drafts.list();
    expect(fetchFn).toHaveBeenCalledOnce();
    const call = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(String(call[0])).toBe('http://api.test/api/v1/owner/drafts');
    const init = call[1] as RequestInit;
    expect(init.method).toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok_abc');
  });

  it('drafts.lock attaches Idempotency-Key when supplied', async () => {
    const { fetchFn, client } = makeClient(() => jsonResponse(200, { ok: true }));
    const tools = createBrainTools(client);
    await tools.drafts.lock({ id: 'd_1', reason: 'final', idempotencyKey: 'idem_1' });
    const call = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('idem_1');
    expect(String(call[0])).toBe('http://api.test/api/v1/owner/drafts/d_1/lock');
  });

  it('reminders.add posts the JSON body', async () => {
    const { fetchFn, client } = makeClient(() => jsonResponse(200, { ok: true }));
    const tools = createBrainTools(client);
    await tools.reminders.add({ text: 'renew', fireAt: '2026-06-01T08:00:00Z' });
    const call = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('"text":"renew"');
  });
});

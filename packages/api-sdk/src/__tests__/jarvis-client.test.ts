/**
 * Tests for createJarvisClient — verifies that each surface routes
 * correctly through the underlying BossnyumbaClient and uses the right
 * paths, methods, and bodies.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createJarvisClient,
  type JarvisSurface,
  type JarvisSurfaceClient,
} from '../jarvis-client.js';
import type { BossnyumbaClient, RequestArgs } from '../client.js';

interface CapturedRequest extends RequestArgs {}

function makeClientStub(): {
  client: BossnyumbaClient;
  calls: CapturedRequest[];
  reply: (value: unknown) => void;
} {
  const calls: CapturedRequest[] = [];
  let nextReply: unknown = { ok: true };
  const request = vi.fn(async (args: RequestArgs) => {
    calls.push(args);
    return nextReply as never;
  });
  const client: BossnyumbaClient = {
    baseUrl: 'http://api',
    config: { baseUrl: 'http://api' },
    request: request as never,
    marketplace: { listings: { list: async () => ({}), get: async () => ({}) } },
    health: { check: async () => ({}) },
  };
  return {
    client,
    calls,
    reply(v) {
      nextReply = v;
    },
  };
}

describe('createJarvisClient — surface path routing', () => {
  const cases: ReadonlyArray<[JarvisSurface, string]> = [
    ['customer', '/api/v1/customer/jarvis'],
    ['owner', '/api/v1/owner/jarvis'],
    ['manager', '/api/v1/manager/jarvis'],
    ['admin', '/api/v1/admin/jarvis'],
    ['platform', '/api/v1/platform/jarvis'],
  ];

  for (const [surface, root] of cases) {
    it(`routes think to ${root}/think for surface=${surface}`, async () => {
      const stub = makeClientStub();
      const j = createJarvisClient(stub.client, surface);
      await j.think({ threadId: 't', userMessage: 'hi' });
      expect(stub.calls[0]?.path).toBe(`${root}/think`);
      expect(stub.calls[0]?.method).toBe('POST');
    });
  }
});

describe('createJarvisClient — endpoints', () => {
  it('think() forwards the request body unchanged', async () => {
    const stub = makeClientStub();
    const j = createJarvisClient(stub.client, 'manager');
    const req = {
      threadId: 'thr',
      userMessage: 'hello',
      stakes: 'high' as const,
    };
    await j.think(req);
    expect(stub.calls[0]?.body).toEqual(req);
  });

  it('briefing() POSTs to /briefing with the request body', async () => {
    const stub = makeClientStub();
    const j = createJarvisClient(stub.client, 'owner');
    await j.briefing({
      day: '2026-05-08',
      threadId: 'thr',
      dataPoints: [],
    });
    expect(stub.calls[0]?.path).toBe('/api/v1/owner/jarvis/briefing');
    expect(stub.calls[0]?.method).toBe('POST');
  });

  it('proposeAction() POSTs to /actions', async () => {
    const stub = makeClientStub();
    const j = createJarvisClient(stub.client, 'platform');
    await j.proposeAction({
      thoughtId: 't',
      summary: 's',
      toolName: 'rent.charge',
    });
    expect(stub.calls[0]?.path).toBe('/api/v1/platform/jarvis/actions');
    expect(stub.calls[0]?.method).toBe('POST');
  });

  it('sign() encodes the actionId into the URL', async () => {
    const stub = makeClientStub();
    const j = createJarvisClient(stub.client, 'manager');
    await j.sign('action 1/2', { verdict: 'approve' });
    expect(stub.calls[0]?.path).toBe(
      '/api/v1/manager/jarvis/actions/action%201%2F2/sign',
    );
  });

  it('getAction() GETs the encoded actionId', async () => {
    const stub = makeClientStub();
    const j = createJarvisClient(stub.client, 'admin');
    await j.getAction('a/b');
    expect(stub.calls[0]?.method).toBe('GET');
    expect(stub.calls[0]?.path).toBe('/api/v1/admin/jarvis/actions/a%2Fb');
  });

  it('listActions() omits the query when no filter is supplied', async () => {
    const stub = makeClientStub();
    const j = createJarvisClient(stub.client, 'customer');
    await j.listActions();
    expect(stub.calls[0]?.method).toBe('GET');
    expect(stub.calls[0]?.path).toBe('/api/v1/customer/jarvis/actions');
    expect(stub.calls[0]?.query).toBeUndefined();
  });

  it('listActions(filter) attaches the status query param', async () => {
    const stub = makeClientStub();
    const j = createJarvisClient(stub.client, 'customer');
    await j.listActions({ status: 'pending' });
    expect(stub.calls[0]?.query).toEqual({ status: 'pending' });
  });

  it('recordFeedback() POSTs to /feedback', async () => {
    const stub = makeClientStub();
    const j = createJarvisClient(stub.client, 'owner');
    await j.recordFeedback({
      thoughtId: 't',
      threadId: 'thr',
      signal: 'thumbs-up',
    });
    expect(stub.calls[0]?.path).toBe('/api/v1/owner/jarvis/feedback');
    expect(stub.calls[0]?.method).toBe('POST');
  });

  it('returns the underlying response value verbatim', async () => {
    const stub = makeClientStub();
    stub.reply({ success: true, surface: 'manager', persona: { id: 'p' } });
    const j: JarvisSurfaceClient = createJarvisClient(stub.client, 'manager');
    const res = await j.think({ threadId: 't', userMessage: 'hi' });
    expect((res as unknown as { surface: string }).surface).toBe('manager');
  });

  it('exposes the surface name on the client', () => {
    const stub = makeClientStub();
    const j = createJarvisClient(stub.client, 'platform');
    expect(j.surface).toBe('platform');
  });

  it('stream() returns a handle without invoking request', () => {
    const stub = makeClientStub();
    const j = createJarvisClient(stub.client, 'customer');
    const handle = j.stream({ threadId: 't', userMessage: 'hi' });
    expect(typeof handle.abort).toBe('function');
    expect(typeof handle.events).toBe('function');
    // No request should have happened until events() is iterated.
    expect(stub.calls).toHaveLength(0);
  });
});

/**
 * Extra tests for webhook-delivery.ts — header/signature wire format,
 * retry until success, fetch-throw handling, and pause threshold.
 */
import { describe, expect, it } from 'vitest';
import {
  deliverToSubscription,
  type FetchLike,
  type WebhookStore,
} from '../webhook-delivery.js';
import type {
  WebhookDelivery,
  WebhookSubscription,
} from '../types.js';

interface CapturedFetch {
  readonly url: string;
  readonly init: {
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body: string;
  };
}

function makeStoreSpy(): {
  store: WebhookStore;
  recorded: WebhookDelivery[];
  patches: Array<{ id: string; patch: Partial<WebhookDelivery> }>;
  failuresPaused: Array<{ id: string; n: number; pause: boolean }>;
  delivered: Array<{ id: string; iso: string }>;
} {
  const recorded: WebhookDelivery[] = [];
  const patches: Array<{ id: string; patch: Partial<WebhookDelivery> }> = [];
  const failuresPaused: Array<{ id: string; n: number; pause: boolean }> = [];
  const delivered: Array<{ id: string; iso: string }> = [];

  const store: WebhookStore = {
    async recordPending(d) {
      recorded.push(d);
    },
    async updateDelivery(id, patch) {
      patches.push({ id, patch });
    },
    async incrementSubscriptionFailure(id, n, pause) {
      failuresPaused.push({ id, n, pause });
    },
    async markSubscriptionDelivered(id, iso) {
      delivered.push({ id, iso });
    },
  };
  return { store, recorded, patches, failuresPaused, delivered };
}

const subscription: WebhookSubscription = Object.freeze({
  id: 'sub-X',
  agentId: 'agent-1',
  tenantId: 'tenant-a',
  eventTypes: ['case.created'],
  url: 'https://hooks.example.com/x',
  secretHash: 'whsec',
  status: 'active',
  failureCount: 0,
  createdAt: '2026-01-01T00:00:00Z',
});

const event = Object.freeze({
  eventType: 'case.created',
  eventId: 'evt-1',
  correlationId: 'cid',
  tenantId: 'tenant-a',
  occurredAt: '2026-05-08T12:00:00Z',
  data: { caseId: 'c1' },
});

describe('webhook-delivery wire format', () => {
  it('sends the SDK-shaped headers (signature, content-type, user-agent)', async () => {
    const captures: CapturedFetch[] = [];
    const fetchLike: FetchLike = async (url, init) => {
      captures.push({
        url,
        init: {
          method: init.method,
          headers: init.headers,
          body: init.body,
        },
      });
      return { status: 200, ok: true };
    };
    const { store } = makeStoreSpy();
    await deliverToSubscription(
      { fetch: fetchLike, store, retryDelaysMs: [] },
      subscription,
      event,
    );
    expect(captures).toHaveLength(1);
    const headers = captures[0]!.init.headers;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['User-Agent']).toBe('BORJIE-Webhook/1.0');
    expect(headers['X-Webhook-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(headers['X-Webhook-Id']).toBeDefined();
    expect(headers['X-Webhook-Timestamp']).toBeDefined();
    expect(headers['X-Request-Id']).toBe('cid');
  });

  it('serialises the canonical body shape', async () => {
    const captures: CapturedFetch[] = [];
    const fetchLike: FetchLike = async (url, init) => {
      captures.push({
        url,
        init: { method: init.method, headers: init.headers, body: init.body },
      });
      return { status: 200, ok: true };
    };
    const { store } = makeStoreSpy();
    await deliverToSubscription(
      { fetch: fetchLike, store, retryDelaysMs: [] },
      subscription,
      event,
    );
    const body = JSON.parse(captures[0]!.init.body) as Record<string, unknown>;
    expect(body.eventType).toBe('case.created');
    expect(body.eventId).toBe('evt-1');
    expect(body.correlationId).toBe('cid');
    expect(body.tenantId).toBe('tenant-a');
    expect(body.occurredAt).toBe('2026-05-08T12:00:00Z');
    expect((body.data as Record<string, unknown>).caseId).toBe('c1');
  });
});

describe('webhook-delivery retries', () => {
  it('records pending then delivered when first attempt succeeds', async () => {
    const fetchLike: FetchLike = async () => ({ status: 200, ok: true });
    const spy = makeStoreSpy();
    const result = await deliverToSubscription(
      { fetch: fetchLike, store: spy.store, retryDelaysMs: [] },
      subscription,
      event,
    );
    expect(spy.recorded).toHaveLength(1);
    expect(spy.recorded[0]!.status).toBe('pending');
    expect(result.status).toBe('delivered');
    expect(spy.delivered).toHaveLength(1);
  });

  it('retries until success and reports the right attempt count', async () => {
    let calls = 0;
    const fetchLike: FetchLike = async () => {
      calls += 1;
      if (calls < 3) return { status: 500, ok: false };
      return { status: 200, ok: true };
    };
    const spy = makeStoreSpy();
    const result = await deliverToSubscription(
      { fetch: fetchLike, store: spy.store, retryDelaysMs: [1, 1, 1, 1] },
      subscription,
      event,
    );
    expect(result.status).toBe('delivered');
    expect(result.attempts).toBe(3);
    expect(calls).toBe(3);
  });

  it('treats fetch throw as a failure and continues retry', async () => {
    let calls = 0;
    const fetchLike: FetchLike = async () => {
      calls += 1;
      if (calls === 1) throw new Error('network down');
      return { status: 200, ok: true };
    };
    const spy = makeStoreSpy();
    const result = await deliverToSubscription(
      { fetch: fetchLike, store: spy.store, retryDelaysMs: [1, 1] },
      subscription,
      event,
    );
    expect(calls).toBe(2);
    expect(result.status).toBe('delivered');
  });

  it('does not pause on first failure when below maxConsecutiveFailures', async () => {
    const fetchLike: FetchLike = async () => ({ status: 500, ok: false });
    const spy = makeStoreSpy();
    await deliverToSubscription(
      {
        fetch: fetchLike,
        store: spy.store,
        retryDelaysMs: [1],
        maxConsecutiveFailures: 5,
      },
      { ...subscription, failureCount: 0 },
      event,
    );
    const last = spy.failuresPaused.at(-1)!;
    expect(last.pause).toBe(false);
    expect(last.n).toBe(1);
  });

  it('pauses after reaching maxConsecutiveFailures (cumulative)', async () => {
    const fetchLike: FetchLike = async () => ({ status: 500, ok: false });
    const spy = makeStoreSpy();
    await deliverToSubscription(
      {
        fetch: fetchLike,
        store: spy.store,
        retryDelaysMs: [1],
        maxConsecutiveFailures: 5,
      },
      { ...subscription, failureCount: 4 }, // already 4, this one makes 5 → pause
      event,
    );
    const last = spy.failuresPaused.at(-1)!;
    expect(last.pause).toBe(true);
    expect(last.n).toBe(5);
  });

  it('writes intermediate "retrying" status updates between attempts', async () => {
    const fetchLike: FetchLike = async () => ({ status: 500, ok: false });
    const spy = makeStoreSpy();
    await deliverToSubscription(
      {
        fetch: fetchLike,
        store: spy.store,
        retryDelaysMs: [1, 1, 1],
      },
      subscription,
      event,
    );
    const statuses = spy.patches.map((p) => p.patch.status);
    // First three attempts should write 'retrying', last should be 'failed'.
    expect(statuses.filter((s) => s === 'retrying').length).toBe(3);
    expect(statuses.filter((s) => s === 'failed').length).toBe(1);
  });
});

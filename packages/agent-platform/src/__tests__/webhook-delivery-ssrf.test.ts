/**
 * A2b-3 wire #4 — webhook-delivery centralised SSRF guard.
 *
 * Previously webhook-delivery shipped an inline `assertSafeWebhookUrl`
 * with its own copy of the internal-range denylist. This file locks in
 * the migration to `@borjie/enterprise-hardening#assertUrlSafe` —
 * the same policy the rest of the platform uses, including the new
 * DNS-resolved-IP gate.
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

function silentStore(): WebhookStore {
  const noop = async () => undefined;
  return {
    recordPending: noop as WebhookStore['recordPending'],
    updateDelivery: noop as WebhookStore['updateDelivery'],
    incrementSubscriptionFailure:
      noop as WebhookStore['incrementSubscriptionFailure'],
    markSubscriptionDelivered:
      noop as WebhookStore['markSubscriptionDelivered'],
  };
}

const sub = (url: string): WebhookSubscription =>
  Object.freeze({
    id: 'sub-x',
    agentId: 'agent-1',
    tenantId: 'tenant-a',
    eventTypes: ['case.created'],
    url,
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

describe('webhook-delivery — central SSRF guard', () => {
  it('rejects a literal loopback URL', async () => {
    const fetchLike: FetchLike = async () => ({ status: 200, ok: true });
    await expect(
      deliverToSubscription(
        { fetch: fetchLike, store: silentStore(), retryDelaysMs: [] },
        sub('http://127.0.0.1/hook'),
        event,
      ),
    ).rejects.toThrow(/denied-internal-ip/);
  });

  it('rejects a literal EC2 metadata IP', async () => {
    const fetchLike: FetchLike = async () => ({ status: 200, ok: true });
    await expect(
      deliverToSubscription(
        { fetch: fetchLike, store: silentStore(), retryDelaysMs: [] },
        sub('http://169.254.169.254/latest/meta-data/'),
        event,
      ),
    ).rejects.toThrow(/denied-internal-ip/);
  });

  it('rejects an attacker hostname that resolves to EC2 metadata IP', async () => {
    const fetchLike: FetchLike = async () => ({ status: 200, ok: true });
    const rebindingLookup = async () => [
      { address: '169.254.169.254', family: 4 as const },
    ];
    await expect(
      deliverToSubscription(
        {
          fetch: fetchLike,
          store: silentStore(),
          retryDelaysMs: [],
          dnsLookup: rebindingLookup,
        },
        sub('https://attacker-controlled.example/hook'),
        event,
      ),
    ).rejects.toThrow(/denied-internal-ip/);
  });

  it('allows a public hostname that resolves to a public IP', async () => {
    const captured: string[] = [];
    const fetchLike: FetchLike = async (url) => {
      captured.push(url);
      return { status: 200, ok: true };
    };
    const publicLookup = async () => [
      { address: '93.184.216.34', family: 4 as const },
    ];
    const result = await deliverToSubscription(
      {
        fetch: fetchLike,
        store: silentStore(),
        retryDelaysMs: [],
        dnsLookup: publicLookup,
      },
      sub('https://hooks.example.com/hook'),
      event,
    );
    expect(captured).toHaveLength(1);
    expect(result.status).toBe('delivered');
  });
});

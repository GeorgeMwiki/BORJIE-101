import { describe, it, expect } from 'vitest';
import { createInMemorySubscriptionRegistry } from '../subscriptions.js';
import { createDispatcher } from '../dispatcher.js';
import type { BorjieMcpAuthContext } from '../types.js';
import type { GatewayClient, GatewayCallInput } from '../gateway-client.js';

function authFor(): BorjieMcpAuthContext {
  return Object.freeze({
    tenantId: 't1',
    ownerId: 'o1',
    agentName: 'sub-agent',
    agentTokenId: 'tok-1',
    scopes: ['owner:read'],
    issuedAt: 0,
    expiresAt: 1_000_000,
    correlationId: 'corr-1',
  });
}

function fakeGateway(): GatewayClient {
  return Object.freeze({
    async call<T>(_input: GatewayCallInput): Promise<T> {
      return {} as T;
    },
  });
}

describe('subscription registry', () => {
  it('tracks subscribers per uri', () => {
    const r = createInMemorySubscriptionRegistry();
    r.subscribe('s1', 'borjie://reminders/upcoming');
    r.subscribe('s2', 'borjie://reminders/upcoming');
    expect(r.subscribersFor('borjie://reminders/upcoming').length).toBe(2);
    r.unsubscribe('s1', 'borjie://reminders/upcoming');
    expect(r.subscribersFor('borjie://reminders/upcoming').length).toBe(1);
  });
  it('releaseSession drops all uris for a session', () => {
    const r = createInMemorySubscriptionRegistry();
    r.subscribe('s1', 'borjie://reminders/upcoming');
    r.subscribe('s1', 'borjie://decisions/recent');
    r.releaseSession('s1');
    expect(r.listForSession('s1').length).toBe(0);
  });
});

describe('resources/subscribe + resources/unsubscribe', () => {
  it('records subscription for a known uri', async () => {
    const registry = createInMemorySubscriptionRegistry();
    const d = createDispatcher({
      gatewayClient: fakeGateway(),
      async killSwitchOpen() {
        return false;
      },
      async auditChainHash() {
        return 'h';
      },
      async resolveAuthContext() {
        return authFor();
      },
      subscriptions: registry,
      sessionId: 'sess-1',
    });
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/subscribe',
        params: { uri: 'borjie://reminders/upcoming' },
      },
      bearerToken: 'tok',
    });
    expect('result' in r).toBe(true);
    expect(registry.subscribersFor('borjie://reminders/upcoming')).toContain('sess-1');
  });
  it('rejects subscriptions on unknown uris', async () => {
    const d = createDispatcher({
      gatewayClient: fakeGateway(),
      async killSwitchOpen() {
        return false;
      },
      async auditChainHash() {
        return 'h';
      },
      async resolveAuthContext() {
        return authFor();
      },
    });
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/subscribe',
        params: { uri: 'borjie://no-such-thing' },
      },
      bearerToken: 'tok',
    });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error.code).toBe(-32601);
  });
  it('unsubscribe is symmetric', async () => {
    const registry = createInMemorySubscriptionRegistry();
    const d = createDispatcher({
      gatewayClient: fakeGateway(),
      async killSwitchOpen() {
        return false;
      },
      async auditChainHash() {
        return 'h';
      },
      async resolveAuthContext() {
        return authFor();
      },
      subscriptions: registry,
      sessionId: 'sess-2',
    });
    await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/subscribe',
        params: { uri: 'borjie://reminders/upcoming' },
      },
      bearerToken: 'tok',
    });
    await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 2,
        method: 'resources/unsubscribe',
        params: { uri: 'borjie://reminders/upcoming' },
      },
      bearerToken: 'tok',
    });
    expect(registry.subscribersFor('borjie://reminders/upcoming')).not.toContain('sess-2');
  });
});

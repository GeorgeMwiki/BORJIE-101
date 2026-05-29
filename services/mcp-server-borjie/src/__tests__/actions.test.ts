import { describe, it, expect } from 'vitest';
import { createDispatcher } from '../dispatcher.js';
import { createEchoActionsHandler, summariseAction } from '../actions.js';
import type { BorjieMcpAuthContext } from '../types.js';
import type { GatewayClient, GatewayCallInput } from '../gateway-client.js';

function authFor(scopes: BorjieMcpAuthContext['scopes']): BorjieMcpAuthContext {
  return Object.freeze({
    tenantId: 't1',
    ownerId: 'o1',
    agentName: 'act',
    agentTokenId: 'tok-1',
    scopes,
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

const baseDeps = {
  gatewayClient: fakeGateway(),
  async killSwitchOpen() {
    return false;
  },
  async auditChainHash() {
    return 'h';
  },
  actionsHandler: createEchoActionsHandler(),
};

describe('actions/navigate', () => {
  it('requires owner:reminders scope', async () => {
    const d = createDispatcher({
      ...baseDeps,
      async resolveAuthContext() {
        return authFor(['owner:read']);
      },
    });
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'actions/navigate',
        params: { target: '/dashboard' },
      },
      bearerToken: 'tok',
    });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error.code).toBe(-32002);
  });
  it('returns ok with bilingual summary on success', async () => {
    const d = createDispatcher({
      ...baseDeps,
      async resolveAuthContext() {
        return authFor(['owner:reminders']);
      },
    });
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'actions/navigate',
        params: { target: '/cockpit/tabs/decisions' },
      },
      bearerToken: 'tok',
    });
    expect('result' in r).toBe(true);
    if ('result' in r) {
      const result = r.result as { ok: boolean; action: string; summary: string; summarySw: string };
      expect(result.ok).toBe(true);
      expect(result.action).toBe('navigate');
      expect(result.summary.length).toBeGreaterThan(0);
      expect(result.summarySw.length).toBeGreaterThan(0);
    }
  });
});

describe('actions/prefill', () => {
  it('returns prefilled count', async () => {
    const d = createDispatcher({
      ...baseDeps,
      async resolveAuthContext() {
        return authFor(['owner:write']);
      },
    });
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'actions/prefill',
        params: { formId: 'compose-draft', values: { a: 1, b: 2 } },
      },
      bearerToken: 'tok',
    });
    expect('result' in r).toBe(true);
  });
});

describe('actions/share', () => {
  it('requires owner:share', async () => {
    const d = createDispatcher({
      ...baseDeps,
      async resolveAuthContext() {
        return authFor(['owner:read']);
      },
    });
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'actions/share',
        params: { entityRef: 'ent-1', hours: 24 },
      },
      bearerToken: 'tok',
    });
    expect('error' in r).toBe(true);
  });
  it('returns a share url with owner:share', async () => {
    const d = createDispatcher({
      ...baseDeps,
      async resolveAuthContext() {
        return authFor(['owner:share']);
      },
    });
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'actions/share',
        params: { entityRef: 'ent-9' },
      },
      bearerToken: 'tok',
    });
    expect('result' in r).toBe(true);
  });
});

describe('actions/undo', () => {
  it('returns undone payload', async () => {
    const d = createDispatcher({
      ...baseDeps,
      async resolveAuthContext() {
        return authFor(['owner:write']);
      },
    });
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'actions/undo',
        params: {},
      },
      bearerToken: 'tok',
    });
    expect('result' in r).toBe(true);
  });
});

describe('summariseAction', () => {
  it('produces sw/en summaries for each kind', () => {
    expect(summariseAction('navigate', { navigatedTo: '/x' }).sw).toContain('cockpit');
    expect(summariseAction('prefill', { prefilled: 3 }).en).toContain('3');
    expect(summariseAction('share', { url: 'https://share.borjie.app/abc' }).en).toContain('https://');
    expect(summariseAction('undo', {}).sw.length).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from 'vitest';
import { createDispatcher } from '../dispatcher.js';
import { createStaticRootsProvider, createMutableRootsProvider } from '../roots.js';
import type { BorjieMcpAuthContext } from '../types.js';
import type { GatewayClient, GatewayCallInput } from '../gateway-client.js';

function authFor(): BorjieMcpAuthContext {
  return Object.freeze({
    tenantId: 't1',
    ownerId: 'o1',
    agentName: 'roots-agent',
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

const baseDeps = {
  gatewayClient: fakeGateway(),
  async killSwitchOpen() {
    return false;
  },
  async auditChainHash() {
    return 'hash';
  },
  async resolveAuthContext() {
    return authFor();
  },
};

describe('roots/list', () => {
  it('returns the static provider roots', async () => {
    const provider = createStaticRootsProvider([
      { uri: 'file:///mining-corpus', name: 'corpus' },
    ]);
    const d = createDispatcher({ ...baseDeps, rootsProvider: provider });
    const r = await d.dispatch({
      request: { jsonrpc: '2.0', id: 1, method: 'roots/list' },
      bearerToken: 'tok',
    });
    expect('result' in r).toBe(true);
    if ('result' in r) {
      const result = r.result as { roots: ReadonlyArray<{ uri: string }> };
      expect(result.roots[0]?.uri).toBe('file:///mining-corpus');
    }
  });

  it('returns an empty list with no provider configured', async () => {
    const d = createDispatcher(baseDeps);
    const r = await d.dispatch({
      request: { jsonrpc: '2.0', id: 1, method: 'roots/list' },
      bearerToken: 'tok',
    });
    expect('result' in r).toBe(true);
    if ('result' in r) {
      const result = r.result as { roots: ReadonlyArray<unknown> };
      expect(result.roots).toEqual([]);
    }
  });
});

describe('mutable roots provider', () => {
  it('supports add / remove / set', async () => {
    const p = createMutableRootsProvider();
    p.set([{ uri: 'file:///a' }]);
    p.add({ uri: 'file:///b' });
    expect((await p.list()).length).toBe(2);
    p.remove('file:///a');
    expect((await p.list()).length).toBe(1);
  });
});

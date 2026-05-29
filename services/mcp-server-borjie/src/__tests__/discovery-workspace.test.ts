import { describe, it, expect } from 'vitest';
import { createDispatcher } from '../dispatcher.js';
import { createEmptyWorkspaceProvider } from '../workspace.js';
import type { BorjieMcpAuthContext } from '../types.js';
import type { GatewayClient, GatewayCallInput } from '../gateway-client.js';

function authFor(): BorjieMcpAuthContext {
  return Object.freeze({
    tenantId: 't1',
    ownerId: 'o1',
    agentName: 'ws',
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
    return 'h';
  },
  async resolveAuthContext() {
    return authFor();
  },
};

describe('tools/list discovery filter', () => {
  it('returns the full set without filter', async () => {
    const d = createDispatcher(baseDeps);
    const r = await d.dispatch({
      request: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      bearerToken: null,
    });
    expect('result' in r).toBe(true);
    if ('result' in r) {
      const result = r.result as { tools: ReadonlyArray<{ name: string }> };
      expect(result.tools.length).toBeGreaterThan(15);
    }
  });

  it('filters by capability substring', async () => {
    const d = createDispatcher(baseDeps);
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: { capability: 'draft' },
      },
      bearerToken: null,
    });
    expect('result' in r).toBe(true);
    if ('result' in r) {
      const result = r.result as { tools: ReadonlyArray<{ name: string }> };
      result.tools.forEach((t) => {
        expect(t.name.toLowerCase()).toContain('draft');
      });
    }
  });
});

describe('resources/list ?since=', () => {
  it('echoes since + asOf when supplied', async () => {
    const d = createDispatcher(baseDeps);
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 3,
        method: 'resources/list',
        params: { since: '2025-01-01T00:00:00Z' },
      },
      bearerToken: null,
    });
    expect('result' in r).toBe(true);
    if ('result' in r) {
      const result = r.result as { since: string; asOf: string };
      expect(result.since).toBe('2025-01-01T00:00:00Z');
      expect(result.asOf).toBeDefined();
    }
  });
});

describe('workspace/state', () => {
  it('returns an empty workspace by default', async () => {
    const d = createDispatcher({
      ...baseDeps,
      workspaceProvider: createEmptyWorkspaceProvider(),
    });
    const r = await d.dispatch({
      request: { jsonrpc: '2.0', id: 1, method: 'workspace/state' },
      bearerToken: 'tok',
    });
    expect('result' in r).toBe(true);
    if ('result' in r) {
      const result = r.result as {
        openTabs: ReadonlyArray<unknown>;
        recentReminders: ReadonlyArray<unknown>;
        pinnedItems: ReadonlyArray<unknown>;
      };
      expect(Array.isArray(result.openTabs)).toBe(true);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { createDispatcher } from '../dispatcher.js';
import type { BorjieMcpAuthContext } from '../types.js';
import type { GatewayCallInput, GatewayClient } from '../gateway-client.js';
import { GatewayError } from '../gateway-client.js';

function authFor(scopes: BorjieMcpAuthContext['scopes']): BorjieMcpAuthContext {
  return Object.freeze({
    tenantId: 't1',
    ownerId: 'o1',
    agentName: 'test-agent',
    agentTokenId: 'tok-1',
    scopes,
    issuedAt: 0,
    expiresAt: 1_000_000,
    correlationId: 'corr-1',
  });
}

function fakeGateway(impl?: (input: GatewayCallInput) => Promise<unknown>): GatewayClient {
  return Object.freeze({
    async call<T>(input: GatewayCallInput): Promise<T> {
      const v = impl ? await impl(input) : { ok: true, data: 'fake' };
      return v as T;
    },
  });
}

const baseDeps = {
  gatewayClient: fakeGateway(),
  async killSwitchOpen() {
    return false;
  },
  async auditChainHash() {
    return 'hash-deadbeef';
  },
  async resolveAuthContext(_t: string | null) {
    return authFor(['owner:read', 'owner:write', 'owner:draft', 'owner:reminders', 'owner:share']);
  },
};

describe('dispatcher.initialize', () => {
  it('returns protocol version + capabilities', async () => {
    const d = createDispatcher(baseDeps);
    const r = await d.dispatch({
      request: { jsonrpc: '2.0', id: 1, method: 'initialize' },
      bearerToken: 'tok',
    });
    expect('result' in r).toBe(true);
    if (!('result' in r)) return;
    const result = r.result as Record<string, unknown>;
    expect(result['protocolVersion']).toBe('2024-11-05');
  });
});

describe('dispatcher.tools/list', () => {
  it('lists all public tools', async () => {
    const d = createDispatcher(baseDeps);
    const r = await d.dispatch({
      request: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      bearerToken: null,
    });
    expect('result' in r).toBe(true);
    if (!('result' in r)) return;
    const result = r.result as { tools: ReadonlyArray<unknown> };
    expect(result.tools.length).toBeGreaterThanOrEqual(15);
  });
});

describe('dispatcher.resources/list', () => {
  it('lists all public resources', async () => {
    const d = createDispatcher(baseDeps);
    const r = await d.dispatch({
      request: { jsonrpc: '2.0', id: 1, method: 'resources/list' },
      bearerToken: null,
    });
    expect('result' in r).toBe(true);
    if (!('result' in r)) return;
    const result = r.result as { resources: ReadonlyArray<{ uri: string }> };
    expect(result.resources.some((x) => x.uri === 'borjie://capabilities')).toBe(true);
  });
});

describe('dispatcher.prompts/list', () => {
  it('lists prompts', async () => {
    const d = createDispatcher(baseDeps);
    const r = await d.dispatch({
      request: { jsonrpc: '2.0', id: 1, method: 'prompts/list' },
      bearerToken: null,
    });
    expect('result' in r).toBe(true);
  });
});

describe('dispatcher.prompts/get', () => {
  it('renders a known prompt', async () => {
    const d = createDispatcher(baseDeps);
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'prompts/get',
        params: { name: 'mining_daily_brief_request', arguments: {} },
      },
      bearerToken: null,
    });
    expect('result' in r).toBe(true);
  });
  it('errors on unknown prompt', async () => {
    const d = createDispatcher(baseDeps);
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'prompts/get',
        params: { name: 'no_such_prompt' },
      },
      bearerToken: null,
    });
    expect('error' in r).toBe(true);
  });
});

describe('dispatcher.tools/call', () => {
  it('rejects unauthenticated calls', async () => {
    const d = createDispatcher({
      ...baseDeps,
      async resolveAuthContext() {
        return null;
      },
    });
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'mining_drafts_list', arguments: {} },
      },
      bearerToken: null,
    });
    expect('error' in r).toBe(true);
  });

  it('rejects insufficient scopes', async () => {
    const d = createDispatcher({
      ...baseDeps,
      async resolveAuthContext() {
        return authFor(['admin:read']);
      },
    });
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'mining_drafts_compose_free_form', arguments: { intent: 'x' } },
      },
      bearerToken: 'tok',
    });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error.code).toBe(-32002);
  });

  it('dispatches a successful tool call and wraps with provenance', async () => {
    const d = createDispatcher({
      ...baseDeps,
      gatewayClient: fakeGateway(async () => ({
        text: 'composed!',
        confidence: 0.91,
        evidenceIds: ['e1', 'e2'],
      })),
    });
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'mining_drafts_compose_free_form',
          arguments: { intent: 'draft an NDA' },
        },
      },
      bearerToken: 'tok',
      idempotencyKey: 'idem-1',
    });
    expect('result' in r).toBe(true);
    if (!('result' in r)) return;
    const result = r.result as {
      ok: boolean;
      provenance: { via: string; agentName: string };
      confidence: number;
      evidenceIds: string[];
    };
    expect(result.ok).toBe(true);
    expect(result.provenance.via).toBe('mcp');
    expect(result.confidence).toBe(0.91);
    expect(result.evidenceIds).toEqual(['e1', 'e2']);
  });

  it('translates GatewayError to JSON-RPC error', async () => {
    const d = createDispatcher({
      ...baseDeps,
      gatewayClient: fakeGateway(async () => {
        throw new GatewayError({
          status: 403,
          code: 'FORBIDDEN',
          message: 'rls denied',
        });
      }),
    });
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'mining_drafts_list', arguments: {} },
      },
      bearerToken: 'tok',
    });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error.code).toBe(-32002);
  });

  it('rejects unknown tool', async () => {
    const d = createDispatcher(baseDeps);
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'no_such_tool', arguments: {} },
      },
      bearerToken: 'tok',
    });
    expect('error' in r).toBe(true);
  });
});

describe('dispatcher.killSwitch', () => {
  it('rejects every call when kill-switch is open', async () => {
    const d = createDispatcher({
      ...baseDeps,
      async killSwitchOpen() {
        return true;
      },
    });
    const r = await d.dispatch({
      request: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      bearerToken: null,
    });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error.code).toBe(-32003);
  });
});

describe('dispatcher.unknownMethod', () => {
  it('errors with method-not-found', async () => {
    const d = createDispatcher(baseDeps);
    const r = await d.dispatch({
      request: { jsonrpc: '2.0', id: 1, method: 'no/such/method' },
      bearerToken: null,
    });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error.code).toBe(-32601);
  });
});

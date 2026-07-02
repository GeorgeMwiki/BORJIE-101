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

describe('dispatcher.four-eye separation-of-duties', () => {
  // Helper: initiate a sovereign tool to create a pending approval, then
  // return its approvalId. Uses a shared approvalStore so the approve leg
  // sees the same row.
  async function initiateFourEye(
    d: ReturnType<typeof createDispatcher>,
    bearerToken = 'tok',
  ): Promise<string> {
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'kill_switch.open', arguments: {} },
      },
      bearerToken,
    });
    // Four-eye returns a JSON-RPC error (-32011 pending) whose data carries
    // the approvalId.
    if (!('error' in r)) throw new Error('expected pending-approval error');
    expect(r.error.code).toBe(-32011);
    const data = r.error.data as { approvalId: string };
    return data.approvalId;
  }

  it('ignores a client-supplied approver — initiator cannot forge a distinct id', async () => {
    // Shared store so initiate + approve hit the same row. The initiator is
    // ownerId 'o1'. A malicious client passes params.approver = a forged
    // distinct id to try to satisfy approver !== initiator. The fix must
    // derive the approver from AUTH only (still 'o1'), so this self-approval
    // is rejected with -32014.
    const { createInMemoryApprovalStore } = await import('../four-eye.js');
    const approvalStore = createInMemoryApprovalStore({ now: () => Date.now() });
    const d = createDispatcher({ ...baseDeps, approvalStore });
    const approvalId = await initiateFourEye(d);
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 2,
        method: 'actions/approve',
        params: { approvalId, approver: 'attacker-forged-distinct-id' },
      },
      bearerToken: 'tok',
    });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error.code).toBe(-32014); // JSON_RPC_APPROVAL_SELF
  });

  it('a distinct authenticated approver (real second signer) still approves', async () => {
    const { createInMemoryApprovalStore } = await import('../four-eye.js');
    const approvalStore = createInMemoryApprovalStore({ now: () => Date.now() });
    // The initiator authenticates as owner 'o1'; the approver authenticates
    // as a DIFFERENT owner 'o2' (same token-id so token-isolation passes,
    // distinct principal so SoD is satisfied).
    let asApprover = false;
    const d = createDispatcher({
      ...baseDeps,
      approvalStore,
      async resolveAuthContext() {
        const base = authFor([
          'owner:read',
          'owner:write',
          'owner:draft',
          'owner:reminders',
          'owner:share',
        ]);
        return asApprover ? { ...base, ownerId: 'o2' } : base;
      },
    });
    const approvalId = await initiateFourEye(d);
    asApprover = true;
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 2,
        method: 'actions/approve',
        // Even with NO approver param, auth-derived 'o2' ≠ initiator 'o1'.
        params: { approvalId },
      },
      bearerToken: 'tok',
    });
    expect('result' in r).toBe(true);
    if ('result' in r) {
      const result = r.result as { status: string };
      expect(result.status).toBe('approved');
    }
  });

  it('self-approval by the same owner is rejected (-32014)', async () => {
    const { createInMemoryApprovalStore } = await import('../four-eye.js');
    const approvalStore = createInMemoryApprovalStore({ now: () => Date.now() });
    const d = createDispatcher({ ...baseDeps, approvalStore });
    const approvalId = await initiateFourEye(d);
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 2,
        method: 'actions/approve',
        params: { approvalId },
      },
      bearerToken: 'tok',
    });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error.code).toBe(-32014);
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

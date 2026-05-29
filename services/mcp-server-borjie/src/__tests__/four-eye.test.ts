import { describe, it, expect } from 'vitest';
import {
  requiresFourEye,
  createInMemoryApprovalStore,
  buildPendingApprovalResponse,
  FOUR_EYE_PREFIXES,
} from '../four-eye.js';
import { createDispatcher } from '../dispatcher.js';
import type { BorjieMcpAuthContext } from '../types.js';
import type { GatewayClient, GatewayCallInput } from '../gateway-client.js';

function authFor(): BorjieMcpAuthContext {
  return Object.freeze({
    tenantId: 't1',
    ownerId: 'o1',
    agentName: 'fe-agent',
    agentTokenId: 'tok-fe',
    scopes: ['owner:write', 'admin:read'],
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

describe('four-eye prefix detection', () => {
  it('recognises all four prefixes', () => {
    expect(requiresFourEye('kill_switch.open')).toBe(true);
    expect(requiresFourEye('four_eye.confirm')).toBe(true);
    expect(requiresFourEye('sovereign.audit')).toBe(true);
    expect(requiresFourEye('policy_rollout.publish')).toBe(true);
    expect(requiresFourEye('mining_drafts_list')).toBe(false);
  });
  it('exports the canonical prefix set', () => {
    expect(FOUR_EYE_PREFIXES.length).toBe(4);
  });
});

describe('approval store', () => {
  it('lifecycles pending -> approved -> consumed', async () => {
    const store = createInMemoryApprovalStore({
      now: () => 1_000,
    });
    const a = await store.create({
      tokenId: 't1',
      toolName: 'kill_switch.open',
      arguments: {},
      expiresAt: 2_000,
    });
    expect(a.status).toBe('pending');
    const approved = await store.approve(a.id, 'owner-1');
    expect(approved.status).toBe('approved');
    const consumed = await store.consume(a.id);
    expect(consumed.status).toBe('consumed');
  });

  it('expires when past TTL', async () => {
    let t = 0;
    const store = createInMemoryApprovalStore({ now: () => t });
    const a = await store.create({
      tokenId: 't1',
      toolName: 'sovereign.act',
      arguments: {},
      expiresAt: 100,
    });
    t = 1_000;
    const r = await store.approve(a.id, 'owner');
    expect(r.status).toBe('expired');
  });

  it('deny path locks status', async () => {
    const store = createInMemoryApprovalStore();
    const a = await store.create({
      tokenId: 't1',
      toolName: 'sovereign.act',
      arguments: {},
      expiresAt: Date.now() + 60_000,
    });
    const denied = await store.deny(a.id, 'owner');
    expect(denied.status).toBe('denied');
  });
});

describe('buildPendingApprovalResponse', () => {
  it('produces owner-web approval url', async () => {
    const store = createInMemoryApprovalStore({ now: () => 1_000 });
    const a = await store.create({
      tokenId: 't1',
      toolName: 'kill_switch.open',
      arguments: {},
      expiresAt: 61_000,
    });
    const resp = buildPendingApprovalResponse({
      approval: a,
      ownerWebBaseUrl: 'https://owner.borjie.app',
      now: () => 1_000,
    });
    expect(resp.approvalUrl).toContain('/oauth/actions/approve?id=');
    expect(resp.expiresInSeconds).toBe(60);
  });
});

describe('dispatcher four-eye gate', () => {
  it('returns pending_approval error code on sovereign tool', async () => {
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
        method: 'tools/call',
        params: { name: 'kill_switch.open', arguments: {} },
      },
      bearerToken: 'tok',
    });
    expect('error' in r).toBe(true);
    if ('error' in r) {
      expect(r.error.code).toBe(-32011);
      expect(r.error.data).toEqual({
        status: 'pending_approval',
        approvalId: expect.any(String),
        approvalUrl: expect.stringContaining('/oauth/actions/approve'),
        expiresInSeconds: expect.any(Number),
      });
    }
  });

  it('approval_status returns current state for the token owner', async () => {
    const store = createInMemoryApprovalStore({
      now: () => 1_000,
    });
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
      approvalStore: store,
    });
    const initiated = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 'a1',
        method: 'tools/call',
        params: { name: 'sovereign.audit', arguments: {} },
      },
      bearerToken: 'tok',
    });
    expect('error' in initiated).toBe(true);
    if (!('error' in initiated)) return;
    const approvalId = (initiated.error.data as { approvalId: string }).approvalId;
    const status = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 'a2',
        method: 'actions/approval_status',
        params: { approvalId },
      },
      bearerToken: 'tok',
    });
    expect('result' in status).toBe(true);
  });
});

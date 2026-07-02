import { describe, it, expect, vi } from 'vitest';
import { createDispatcher } from '../dispatcher.js';
import { createInMemoryApprovalStore } from '../four-eye.js';
import type { BorjieMcpAuthContext } from '../types.js';
import type { GatewayClient, GatewayCallInput } from '../gateway-client.js';

function authFor(): BorjieMcpAuthContext {
  return Object.freeze({
    tenantId: 't1',
    ownerId: 'owner-1',
    agentName: 'fe-agent',
    agentTokenId: 'tok-fe',
    scopes: ['owner:read', 'owner:write'],
    issuedAt: 0,
    expiresAt: 1_000_000,
    correlationId: 'corr-1',
  });
}

function recordingGateway(calls: GatewayCallInput[]): GatewayClient {
  return Object.freeze({
    async call<T>(input: GatewayCallInput): Promise<T> {
      calls.push(input);
      return { ok: true, data: 'exec-ok' } as T;
    },
  });
}

/**
 * Finding (b) — the four-eye gate was a dead-end: approve()/consume() had
 * ZERO callers so the gate could only ever REJECT. These prove the new
 * approve → execute (consume + re-exec) path is REACHABLE and single-use.
 *
 * Finding (c) — the proxied tools/call forwarded the opaque agent token as
 * the downstream bearer, which the JWT-only gateway 401s. The mint test
 * proves the resolved identity is exchanged for a gateway-accepted token.
 */
describe('four-eye re-exec reachability (finding b)', () => {
  it('approve → execute consumes the approval and runs the tool', async () => {
    const store = createInMemoryApprovalStore();
    const calls: GatewayCallInput[] = [];
    const d = createDispatcher({
      gatewayClient: recordingGateway(calls),
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

    // Seed a pending approval whose toolName is a real routed tool.
    const approval = await store.create({
      tokenId: 'tok-fe',
      toolName: 'mining_drafts_list',
      arguments: {},
      expiresAt: Date.now() + 60_000,
    });

    // RED-before: with approval still `pending`, execute must NOT run.
    const pendingExec = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'actions/execute',
        params: { approvalId: approval.id },
      },
      bearerToken: 'agent-opaque',
    });
    expect('error' in pendingExec).toBe(true);
    if ('error' in pendingExec) expect(pendingExec.error.code).toBe(-32011);
    expect(calls.length).toBe(0);

    // Owner approves (approve() — previously had zero callers).
    const approved = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 2,
        method: 'actions/approve',
        params: { approvalId: approval.id, approver: 'owner-1' },
      },
      bearerToken: 'agent-opaque',
    });
    expect('result' in approved).toBe(true);

    // Execute now consumes + runs the gateway call.
    const executed = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 3,
        method: 'actions/execute',
        params: { approvalId: approval.id },
      },
      bearerToken: 'agent-opaque',
    });
    expect('result' in executed).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]?.path).toBe('/api/v1/owner/drafts');

    // Single-use: a replay after consume must be rejected (no double-fire).
    const replay = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 4,
        method: 'actions/execute',
        params: { approvalId: approval.id },
      },
      bearerToken: 'agent-opaque',
    });
    expect('error' in replay).toBe(true);
    expect(calls.length).toBe(1);
  });

  it('denied approval cannot execute', async () => {
    const store = createInMemoryApprovalStore();
    const calls: GatewayCallInput[] = [];
    const d = createDispatcher({
      gatewayClient: recordingGateway(calls),
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
    const approval = await store.create({
      tokenId: 'tok-fe',
      toolName: 'mining_drafts_list',
      arguments: {},
      expiresAt: Date.now() + 60_000,
    });
    await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'actions/deny',
        params: { approvalId: approval.id },
      },
      bearerToken: 'agent-opaque',
    });
    const executed = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 2,
        method: 'actions/execute',
        params: { approvalId: approval.id },
      },
      bearerToken: 'agent-opaque',
    });
    expect('error' in executed).toBe(true);
    if ('error' in executed) expect(executed.error.code).toBe(-32012);
    expect(calls.length).toBe(0);
  });

  it('approve rejects an approval belonging to another token', async () => {
    const store = createInMemoryApprovalStore();
    const d = createDispatcher({
      gatewayClient: recordingGateway([]),
      async killSwitchOpen() {
        return false;
      },
      async auditChainHash() {
        return 'h';
      },
      async resolveAuthContext() {
        return authFor(); // agentTokenId: 'tok-fe'
      },
      approvalStore: store,
    });
    const approval = await store.create({
      tokenId: 'someone-else',
      toolName: 'mining_drafts_list',
      arguments: {},
      expiresAt: Date.now() + 60_000,
    });
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'actions/approve',
        params: { approvalId: approval.id },
      },
      bearerToken: 'agent-opaque',
    });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error.code).toBe(-32002); // FORBIDDEN
  });
});

describe('downstream token exchange (finding c)', () => {
  it('tools/call forwards the MINTED token, not the opaque agent bearer', async () => {
    const calls: GatewayCallInput[] = [];
    const mint = vi.fn(async () => 'minted.jwt.token');
    const d = createDispatcher({
      gatewayClient: recordingGateway(calls),
      async killSwitchOpen() {
        return false;
      },
      async auditChainHash() {
        return 'h';
      },
      async resolveAuthContext() {
        return authFor();
      },
      mintDownstreamToken: mint,
    });
    const r = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'mining_drafts_list', arguments: {} },
      },
      bearerToken: 'opaque-agent-token',
    });
    expect('result' in r).toBe(true);
    expect(mint).toHaveBeenCalledTimes(1);
    expect(calls.length).toBe(1);
    // The opaque agent token would 401 the JWT-only gateway; the minted
    // JWT is what actually flows downstream.
    expect(calls[0]?.accessToken).toBe('minted.jwt.token');
    expect(calls[0]?.accessToken).not.toBe('opaque-agent-token');
  });

  it('falls back to the raw bearer when no minter is wired (stdio/dev)', async () => {
    const calls: GatewayCallInput[] = [];
    const d = createDispatcher({
      gatewayClient: recordingGateway(calls),
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
    await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'mining_drafts_list', arguments: {} },
      },
      bearerToken: 'raw-bearer',
    });
    expect(calls[0]?.accessToken).toBe('raw-bearer');
  });
});

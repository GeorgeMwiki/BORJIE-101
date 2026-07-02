import { describe, it, expect } from 'vitest';
import { createDispatcher } from '../dispatcher.js';
import {
  createInMemoryApprovalStore,
  SelfApprovalError,
} from '../four-eye.js';
import { JSON_RPC_APPROVAL_SELF } from '../jsonrpc.js';
import type { BorjieMcpAuthContext } from '../types.js';
import type { GatewayClient, GatewayCallInput } from '../gateway-client.js';

/**
 * Four-eye SEPARATION-OF-DUTIES: the approver of a pending sovereign /
 * kill-switch / four-eye / policy-rollout action MUST be a different
 * principal than the initiator. A gate whose approver can be the initiator
 * is not two-person control.
 *
 * RED-before: prior to the fix `actions/approve` bound the approval only to
 * the initiating agent-token, so the same actor that initiated could
 * approve (self-approval accepted). GREEN-after: self-approval is rejected
 * with JSON_RPC_APPROVAL_SELF (-32014); a distinct second approver is
 * accepted.
 */

function authFor(): BorjieMcpAuthContext {
  return Object.freeze({
    tenantId: 't1',
    ownerId: 'owner-initiator',
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

async function initiateFourEye(
  d: ReturnType<typeof createDispatcher>,
): Promise<string> {
  const initiated = await d.dispatch({
    request: {
      jsonrpc: '2.0',
      id: 'init',
      method: 'tools/call',
      params: { name: 'sovereign.audit', arguments: {} },
    },
    bearerToken: 'tok',
  });
  expect('error' in initiated).toBe(true);
  if (!('error' in initiated)) throw new Error('expected pending_approval');
  return (initiated.error.data as { approvalId: string }).approvalId;
}

describe('four-eye separation-of-duties (dispatcher)', () => {
  it('rejects self-approval — initiator cannot approve their own action', async () => {
    const store = createInMemoryApprovalStore();
    const d = createDispatcher({
      gatewayClient: fakeGateway(),
      async killSwitchOpen() {
        return false;
      },
      async auditChainHash() {
        return 'h';
      },
      async resolveAuthContext() {
        return authFor(); // ownerId: 'owner-initiator'
      },
      approvalStore: store,
    });

    const approvalId = await initiateFourEye(d);

    // The initiator (same auth → resolves to 'owner-initiator') tries to
    // approve their own pending action. Must be rejected.
    const selfApprove = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 'self',
        method: 'actions/approve',
        params: { approvalId },
      },
      bearerToken: 'tok',
    });
    expect('error' in selfApprove).toBe(true);
    if ('error' in selfApprove) {
      expect(selfApprove.error.code).toBe(JSON_RPC_APPROVAL_SELF);
      expect(selfApprove.error.code).toBe(-32014);
    }

    // The row must remain pending (not flipped to approved).
    const row = await store.get(approvalId);
    expect(row?.status).toBe('pending');
  });

  it('rejects self-approval even when the initiator id is passed explicitly', async () => {
    const store = createInMemoryApprovalStore();
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

    const approvalId = await initiateFourEye(d);

    const selfApprove = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 'self2',
        method: 'actions/approve',
        // Explicitly claim the approver is the initiator — still rejected.
        params: { approvalId, approver: 'owner-initiator' },
      },
      bearerToken: 'tok',
    });
    expect('error' in selfApprove).toBe(true);
    if ('error' in selfApprove) {
      expect(selfApprove.error.code).toBe(JSON_RPC_APPROVAL_SELF);
    }
    expect((await store.get(approvalId))?.status).toBe('pending');
  });

  it('accepts a DISTINCT second approver', async () => {
    const store = createInMemoryApprovalStore();
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

    const approvalId = await initiateFourEye(d);

    const approved = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 'ok',
        method: 'actions/approve',
        // A second, distinct principal approves — two-person control.
        params: { approvalId, approver: 'owner-second-signer' },
      },
      bearerToken: 'tok',
    });
    expect('result' in approved).toBe(true);
    if ('result' in approved) {
      expect((approved.result as { status: string }).status).toBe('approved');
    }
    const row = await store.get(approvalId);
    expect(row?.status).toBe('approved');
    expect(row?.approvedBy).toBe('owner-second-signer');
  });
});

describe('four-eye separation-of-duties (store)', () => {
  it('throws SelfApprovalError when approver equals initiator', async () => {
    const store = createInMemoryApprovalStore();
    const a = await store.create({
      tokenId: 'tok-fe',
      toolName: 'sovereign.audit',
      arguments: {},
      expiresAt: Date.now() + 60_000,
      initiatedBy: 'owner-initiator',
    });
    await expect(store.approve(a.id, 'owner-initiator')).rejects.toBeInstanceOf(
      SelfApprovalError,
    );
    // Row stays pending after a rejected self-approval.
    expect((await store.get(a.id))?.status).toBe('pending');
    // A distinct approver succeeds.
    const ok = await store.approve(a.id, 'owner-second-signer');
    expect(ok.status).toBe('approved');
  });
});

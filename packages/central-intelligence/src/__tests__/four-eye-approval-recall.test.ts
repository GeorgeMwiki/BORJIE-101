/**
 * Four-eye approval — recall API tests — Phase D / D12.9.
 */

import { describe, it, expect } from 'vitest';
import {
  createApprovalGate,
  createInMemoryApprovalStore,
  buildApprovalPolicy,
  DEFAULT_APPROVAL_POLICY,
  type ApprovalPolicy,
} from '../kernel/four-eye-approval.js';

function recallablePolicy(over: Partial<ApprovalPolicy> = {}): ApprovalPolicy {
  return buildApprovalPolicy({
    roleGroups: [
      { name: 'admin', minApprovers: 1 },
      { name: 'compliance', minApprovers: 1 },
    ],
    maxStaleMinutes: 60,
    recallWindowMinutes: over.recallWindowMinutes ?? 30,
  });
}

describe('approval gate — recall API (D12.9)', () => {
  it('proposer can recall a pending action within the window', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const proposal = await gate.propose({
      proposerUserId: 'u_proposer',
      thoughtId: 'thg_1',
      summary: 'evict 4B',
      toolName: 'tenant-eviction-proposed',
      payload: { unit: '4B' },
      stakes: 'critical',
      policy: recallablePolicy(),
    });

    const recalled = await gate.recall({
      actionId: proposal.action.id,
      initiatorUserId: 'u_proposer',
      reason: 'updated arrears ledger revealed pending payment',
    });
    expect(recalled.status).toBe('recalled');
    expect(recalled.recallEntry?.initiatorUserId).toBe('u_proposer');
    expect(recalled.recallEntry?.reason).toContain('updated arrears');
  });

  it('rejects recall from someone other than the proposer', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const proposal = await gate.propose({
      proposerUserId: 'u_proposer',
      thoughtId: 'thg_2',
      summary: 's',
      toolName: 'owner-payout-executed',
      payload: {},
      stakes: 'critical',
      policy: recallablePolicy(),
    });
    await expect(
      gate.recall({
        actionId: proposal.action.id,
        initiatorUserId: 'u_someone_else',
        reason: 'I want to recall',
      }),
    ).rejects.toThrow(/only the original proposer/);
  });

  it('rejects recall when the policy has recallWindowMinutes=0', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const proposal = await gate.propose({
      proposerUserId: 'u_proposer',
      thoughtId: 'thg_3',
      summary: 's',
      toolName: 'kra-mri-filed',
      payload: {},
      stakes: 'critical',
      // Default policy has recallWindowMinutes=0
      policy: DEFAULT_APPROVAL_POLICY,
    });
    await expect(
      gate.recall({
        actionId: proposal.action.id,
        initiatorUserId: 'u_proposer',
        reason: 'changed my mind',
      }),
    ).rejects.toThrow(/does not permit recall/);
  });

  it('rejects recall after the recall window has elapsed', async () => {
    let nowMs = Date.parse('2026-05-17T08:00:00.000Z');
    const clock = (): Date => new Date(nowMs);
    const gate = createApprovalGate({
      store: createInMemoryApprovalStore(),
      clock,
    });
    const proposal = await gate.propose({
      proposerUserId: 'u_proposer',
      thoughtId: 'thg_4',
      summary: 's',
      toolName: 'tenant-eviction-proposed',
      payload: {},
      stakes: 'critical',
      policy: recallablePolicy({ recallWindowMinutes: 15 }),
    });
    // Advance the clock past the window.
    nowMs += 16 * 60_000;
    await expect(
      gate.recall({
        actionId: proposal.action.id,
        initiatorUserId: 'u_proposer',
        reason: 'late recall',
      }),
    ).rejects.toThrow(/recall window expired/);
  });

  it('rejects recall of an approved action', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const policy = buildApprovalPolicy({
      roleGroups: [{ name: 'admin', minApprovers: 1 }],
      maxStaleMinutes: 60,
      recallWindowMinutes: 30,
    });
    const proposal = await gate.propose({
      proposerUserId: 'u_proposer',
      thoughtId: 'thg_5',
      summary: 's',
      toolName: 'kra-mri-filed',
      payload: {},
      stakes: 'critical',
      policy,
    });
    await gate.sign({
      actionId: proposal.action.id,
      approverUserId: 'u_admin_1',
      roleGroup: 'admin',
      verdict: 'approve',
    });
    await expect(
      gate.recall({
        actionId: proposal.action.id,
        initiatorUserId: 'u_proposer',
        reason: 'oops',
      }),
    ).rejects.toThrow(/already approved/);
  });

  it('rejects a recall with an empty reason', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const proposal = await gate.propose({
      proposerUserId: 'u_proposer',
      thoughtId: 'thg_6',
      summary: 's',
      toolName: 'owner-payout-executed',
      payload: {},
      stakes: 'critical',
      policy: recallablePolicy(),
    });
    await expect(
      gate.recall({
        actionId: proposal.action.id,
        initiatorUserId: 'u_proposer',
        reason: '   ',
      }),
    ).rejects.toThrow(/reason must not be empty/);
  });

  it('a recalled action cannot be signed afterwards', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const proposal = await gate.propose({
      proposerUserId: 'u_proposer',
      thoughtId: 'thg_7',
      summary: 's',
      toolName: 'tenant-eviction-proposed',
      payload: {},
      stakes: 'critical',
      policy: recallablePolicy(),
    });
    await gate.recall({
      actionId: proposal.action.id,
      initiatorUserId: 'u_proposer',
      reason: 'pulling it back',
    });
    const signed = await gate.sign({
      actionId: proposal.action.id,
      approverUserId: 'u_admin_1',
      roleGroup: 'admin',
      verdict: 'approve',
    });
    // sign() returns the existing recalled record without modifying.
    expect(signed.status).toBe('recalled');
    expect(signed.signatures.length).toBe(0);
  });

  it('rejects recall of an unknown action id', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    await expect(
      gate.recall({
        actionId: 'does-not-exist',
        initiatorUserId: 'u_proposer',
        reason: 'r',
      }),
    ).rejects.toThrow(/unknown action/);
  });
});

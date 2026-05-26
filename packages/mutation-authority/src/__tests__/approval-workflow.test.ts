import { describe, expect, it } from 'vitest';
import { applyEvent } from '../approvals/approval-workflow.js';
import type {
  ApprovalRecord,
  MutationProposal,
} from '../types.js';

function fakeProposal(
  overrides: Partial<MutationProposal> = {},
): MutationProposal {
  return {
    id: 'p-1',
    recipe_id: 'parcel_update',
    recipe_version: 1,
    tenant_id: 't-1',
    proposed_by: 'mr_mwikila',
    proposed_at: '2026-05-26T10:00:00.000Z',
    subject: { kind: 'parcel', id: 'p-1' },
    preview: { summary: 's', current: null, proposed: null },
    research_evidence_ids: [],
    cost_or_value_at_stake_usd_cents: 0,
    reversibility: 'fully',
    authority_tier: 1,
    requires_double_verify: false,
    expires_at: '2026-05-27T10:00:00.000Z',
    audit_hash: 'h',
    ...overrides,
  };
}

describe('applyEvent — tier 1 auto-promote', () => {
  it('auto-promotes a tier-1 proposal to approved_full', () => {
    const proposal = fakeProposal();
    const out = applyEvent({
      proposal,
      currentStatus: 'pending',
      priorApprovals: [],
      event: {
        kind: 'auto_promote',
        proposalId: proposal.id,
        atIso: '2026-05-27T10:00:00.000Z',
      },
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.nextStatus).toBe('approved_full');
      expect(out.readyToExecute).toBe(true);
    }
  });

  it('refuses auto_promote on a critical proposal', () => {
    const proposal = fakeProposal({
      authority_tier: 2,
      requires_double_verify: true,
    });
    const out = applyEvent({
      proposal,
      currentStatus: 'pending',
      priorApprovals: [],
      event: {
        kind: 'auto_promote',
        proposalId: proposal.id,
        atIso: '2026-05-27T10:00:00.000Z',
      },
    });
    expect(out.ok).toBe(false);
  });
});

describe('applyEvent — tier 2 explicit owner approval', () => {
  it('promotes a non-critical tier-2 proposal directly to approved_full on owner approve', () => {
    const proposal = fakeProposal({
      authority_tier: 2,
      requires_double_verify: false,
    });
    const out = applyEvent({
      proposal,
      currentStatus: 'pending',
      priorApprovals: [],
      event: {
        kind: 'decide',
        proposalId: proposal.id,
        approverUserId: 'owner-1',
        approverRole: 'owner',
        decision: 'approved',
        reasoning: 'ok',
        decidedAt: '2026-05-26T10:30:00.000Z',
      },
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.nextStatus).toBe('approved_full');
      expect(out.readyToExecute).toBe(true);
      expect(out.approvalRecord?.approver_role).toBe('owner');
    }
  });

  it('promotes a critical proposal to approved_primary on owner approve', () => {
    const proposal = fakeProposal({
      authority_tier: 2,
      requires_double_verify: true,
    });
    const out = applyEvent({
      proposal,
      currentStatus: 'pending',
      priorApprovals: [],
      event: {
        kind: 'decide',
        proposalId: proposal.id,
        approverUserId: 'owner-1',
        approverRole: 'owner',
        decision: 'approved',
        reasoning: 'ok',
        decidedAt: '2026-05-26T10:30:00.000Z',
      },
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.nextStatus).toBe('approved_primary');
      expect(out.readyToExecute).toBe(false);
    }
  });
});

describe('applyEvent — tier 2-critical second authoriser', () => {
  it('promotes to approved_full when second authoriser approves after cooldown', () => {
    const proposal = fakeProposal({
      authority_tier: 2,
      requires_double_verify: true,
    });
    const primary: ApprovalRecord = {
      proposal_id: proposal.id,
      approver_user_id: 'owner-1',
      approver_role: 'owner',
      decision: 'approved',
      reasoning: 'ok',
      decided_at: '2026-05-26T10:30:00.000Z',
      audit_hash: 'h',
    };
    const out = applyEvent({
      proposal,
      currentStatus: 'approved_primary',
      priorApprovals: [primary],
      event: {
        kind: 'decide',
        proposalId: proposal.id,
        approverUserId: 'cfo-1',
        approverRole: 'second_authoriser',
        decision: 'approved',
        reasoning: 'confirmed',
        // 10 minutes later — beyond the 5-minute cooldown
        decidedAt: '2026-05-26T10:40:00.000Z',
      },
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.nextStatus).toBe('approved_full');
      expect(out.readyToExecute).toBe(true);
    }
  });

  it('rejects when second authoriser fires before owner approval', () => {
    const proposal = fakeProposal({
      authority_tier: 2,
      requires_double_verify: true,
    });
    const out = applyEvent({
      proposal,
      currentStatus: 'pending',
      priorApprovals: [],
      event: {
        kind: 'decide',
        proposalId: proposal.id,
        approverUserId: 'cfo-1',
        approverRole: 'second_authoriser',
        decision: 'approved',
        reasoning: 'jumped the gun',
        decidedAt: '2026-05-26T10:30:00.000Z',
      },
    });
    expect(out.ok).toBe(false);
  });

  it('refuses any event after the proposal is in a terminal state', () => {
    const proposal = fakeProposal();
    const out = applyEvent({
      proposal,
      currentStatus: 'rejected',
      priorApprovals: [],
      event: {
        kind: 'decide',
        proposalId: proposal.id,
        approverUserId: 'owner-1',
        approverRole: 'owner',
        decision: 'approved',
        reasoning: 'too late',
        decidedAt: '2026-05-26T10:30:00.000Z',
      },
    });
    expect(out.ok).toBe(false);
  });

  it('expire event moves proposal to expired', () => {
    const proposal = fakeProposal();
    const out = applyEvent({
      proposal,
      currentStatus: 'pending',
      priorApprovals: [],
      event: {
        kind: 'expire',
        proposalId: proposal.id,
        atIso: '2026-05-30T10:00:00.000Z',
      },
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.nextStatus).toBe('expired');
  });

  it('owner rejection terminates the proposal', () => {
    const proposal = fakeProposal({
      authority_tier: 2,
      requires_double_verify: true,
    });
    const out = applyEvent({
      proposal,
      currentStatus: 'pending',
      priorApprovals: [],
      event: {
        kind: 'decide',
        proposalId: proposal.id,
        approverUserId: 'owner-1',
        approverRole: 'owner',
        decision: 'rejected',
        reasoning: 'too risky',
        decidedAt: '2026-05-26T10:30:00.000Z',
      },
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.nextStatus).toBe('rejected');
  });
});

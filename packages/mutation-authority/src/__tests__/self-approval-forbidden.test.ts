/**
 * Wave-5 invariant 3 — self-T2 approval is forbidden (four-eye).
 *
 * The four-eye rule the existing `checkDoubleVerify` enforces is
 * "primary approver != second approver". That doesn't catch the case
 * where a delegated admin INITIATES a proposal AND then approves it
 * themselves — the system would happily accept a single approval row
 * from the same user who issued the proposal, because the proposal's
 * `proposed_by` field is a category (`mr_mwikila` | `owner_explicit`),
 * not a user id.
 *
 * Wave-5 closes the gap by threading an optional `initiatorUserId`
 * into `applyEvent`. When supplied, the workflow rejects any `decide`
 * event whose `approverUserId` matches it with
 * `reason = 'self_approval_forbidden'`.
 */

import { describe, expect, it } from 'vitest';
import { applyEvent } from '../approvals/approval-workflow.js';
import type { ApprovalRecord, MutationProposal } from '../types.js';

function tier2Proposal(
  overrides: Partial<MutationProposal> = {},
): MutationProposal {
  return {
    id: 'p-1',
    recipe_id: 'mutate_billing',
    recipe_version: 1,
    tenant_id: 't-borjie',
    proposed_by: 'owner_explicit',
    proposed_at: '2026-05-26T10:00:00.000Z',
    subject: { kind: 'billing', id: 'inv-1' },
    preview: { summary: 's', current: null, proposed: null },
    research_evidence_ids: ['ev-1'],
    cost_or_value_at_stake_usd_cents: 10_000_00,
    reversibility: 'partial',
    authority_tier: 2,
    requires_double_verify: true,
    expires_at: '2026-06-09T10:00:00.000Z',
    audit_hash: 'h',
    ...overrides,
  };
}

describe('invariant 3 — self-approval is forbidden on T2', () => {
  it('rejects a decide event when the approver is the initiator (owner role)', () => {
    const proposal = tier2Proposal();
    const out = applyEvent({
      proposal,
      currentStatus: 'pending',
      priorApprovals: [],
      initiatorUserId: 'admin-U',
      event: {
        kind: 'decide',
        proposalId: proposal.id,
        approverUserId: 'admin-U', // same as initiator
        approverRole: 'owner',
        decision: 'approved',
        reasoning: 'self-rubber-stamp',
        decidedAt: '2026-05-26T10:30:00.000Z',
      },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe('self_approval_forbidden');
    }
  });

  it('rejects a decide event when the approver is the initiator (second_authoriser role)', () => {
    const proposal = tier2Proposal();
    const primary: ApprovalRecord = {
      proposal_id: proposal.id,
      approver_user_id: 'owner-real',
      approver_role: 'owner',
      decision: 'approved',
      reasoning: 'looks fine',
      decided_at: '2026-05-26T10:30:00.000Z',
      audit_hash: 'h',
    };
    const out = applyEvent({
      proposal,
      currentStatus: 'approved_primary',
      priorApprovals: [primary],
      initiatorUserId: 'admin-U',
      event: {
        kind: 'decide',
        proposalId: proposal.id,
        approverUserId: 'admin-U', // initiator trying second_authoriser slot
        approverRole: 'second_authoriser',
        decision: 'approved',
        reasoning: 'sneaky',
        decidedAt: '2026-05-26T10:36:00.000Z',
      },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe('self_approval_forbidden');
    }
  });

  it('allows a decide event when the approver differs from the initiator', () => {
    const proposal = tier2Proposal();
    const out = applyEvent({
      proposal,
      currentStatus: 'pending',
      priorApprovals: [],
      initiatorUserId: 'admin-U',
      event: {
        kind: 'decide',
        proposalId: proposal.id,
        approverUserId: 'owner-real', // distinct from initiator
        approverRole: 'owner',
        decision: 'approved',
        reasoning: 'ok',
        decidedAt: '2026-05-26T10:30:00.000Z',
      },
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.nextStatus).toBe('approved_primary');
    }
  });

  it('full T2-critical flow — initiator U cannot complete double-verify alone', () => {
    const proposal = tier2Proposal();

    // Step 1 — U attempts owner-role approval on their own proposal.
    const step1 = applyEvent({
      proposal,
      currentStatus: 'pending',
      priorApprovals: [],
      initiatorUserId: 'admin-U',
      event: {
        kind: 'decide',
        proposalId: proposal.id,
        approverUserId: 'admin-U',
        approverRole: 'owner',
        decision: 'approved',
        reasoning: 'me',
        decidedAt: '2026-05-26T10:30:00.000Z',
      },
    });
    expect(step1.ok).toBe(false);
    if (!step1.ok) expect(step1.reason).toBe('self_approval_forbidden');

    // Step 2 — owner-real does the primary approval (legitimate).
    const step2 = applyEvent({
      proposal,
      currentStatus: 'pending',
      priorApprovals: [],
      initiatorUserId: 'admin-U',
      event: {
        kind: 'decide',
        proposalId: proposal.id,
        approverUserId: 'owner-real',
        approverRole: 'owner',
        decision: 'approved',
        reasoning: 'inspected by owner',
        decidedAt: '2026-05-26T10:30:00.000Z',
      },
    });
    expect(step2.ok).toBe(true);
    if (!step2.ok) return;
    expect(step2.nextStatus).toBe('approved_primary');

    // Step 3 — U attempts second_authoriser. Still blocked.
    const primary = step2.approvalRecord!;
    const step3 = applyEvent({
      proposal,
      currentStatus: 'approved_primary',
      priorApprovals: [primary],
      initiatorUserId: 'admin-U',
      event: {
        kind: 'decide',
        proposalId: proposal.id,
        approverUserId: 'admin-U',
        approverRole: 'second_authoriser',
        decision: 'approved',
        reasoning: 'finishing the loop',
        decidedAt: '2026-05-26T10:36:00.000Z',
      },
    });
    expect(step3.ok).toBe(false);
    if (!step3.ok) expect(step3.reason).toBe('self_approval_forbidden');
  });

  it('omitting initiatorUserId preserves backward compatibility (existing flows unaffected)', () => {
    const proposal = tier2Proposal();
    const out = applyEvent({
      proposal,
      currentStatus: 'pending',
      priorApprovals: [],
      // initiatorUserId intentionally omitted — pre-Wave-5 behaviour.
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
    if (out.ok) expect(out.nextStatus).toBe('approved_primary');
  });
});

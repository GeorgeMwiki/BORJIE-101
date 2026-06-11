import { describe, it, expect } from 'vitest';
import { assertApplyApproved } from '../four-eye-gate.js';
import { TENANT, buildApprovalView } from './fakes.js';

const base = {
  tenantId: TENANT,
  moduleId: 'mod_0001',
  specId: 'mspec_0001',
  specSqlHash: 'sha256:deadbeef',
};

describe('assertApplyApproved — HARD RULE 3 four-eye gate', () => {
  it('authorizes a valid second-admin approval (proposer != two approvers)', () => {
    const r = assertApplyApproved({ ...base, approval: buildApprovalView() });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects when there is no approval record', () => {
    const r = assertApplyApproved({ ...base, approval: null });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/no approval/i);
  });

  it('rejects self-approval (proposer is also the approver)', () => {
    const approval = buildApprovalView({
      proposerUserId: 'user_x',
      approverIds: ['user_x', 'user_admin_b'],
    });
    const r = assertApplyApproved({ ...base, approval });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/self-approval|proposer != approver/i);
  });

  it('rejects a non-approved status (pending/one-eye/rejected)', () => {
    for (const status of ['pending', 'one-eye', 'rejected', 'expired']) {
      const r = assertApplyApproved({
        ...base,
        approval: buildApprovalView({ status }),
      });
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toMatch(/not 'approved'/);
    }
  });

  it('rejects an approval for a different spec SQL hash (stale/replayed)', () => {
    const r = assertApplyApproved({
      ...base,
      approval: buildApprovalView({ specSqlHash: 'sha256:OTHER' }),
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/specSqlHash does not match/i);
  });

  it('rejects when the approval payload lacks the specSqlHash binding', () => {
    const approval = buildApprovalView();
    const stripped = {
      ...approval,
      action: { ...approval.action, payload: { moduleId: 'mod_0001' } },
    };
    const r = assertApplyApproved({ ...base, approval: stripped });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/missing specSqlHash/i);
  });

  it('rejects an already-executed approval (one-shot consumed)', () => {
    const r = assertApplyApproved({
      ...base,
      approval: buildApprovalView({ executed: true }),
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/already executed/i);
  });

  it('rejects an approval whose action is not a module-spawn tool', () => {
    const r = assertApplyApproved({
      ...base,
      approval: buildApprovalView({ toolName: 'royalty.disburse' }),
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/not a module-spawn/i);
  });

  it('rejects an approval scoped to a different tenant', () => {
    const r = assertApplyApproved({
      ...base,
      approval: buildApprovalView({ tenantId: 'other_tenant' }),
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/tenant/i);
  });

  it('rejects an approval whose moduleId binding mismatches', () => {
    const r = assertApplyApproved({
      ...base,
      approval: buildApprovalView({ moduleId: 'mod_OTHER' }),
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/moduleId does not match/i);
  });

  it('rejects when no approving signature is present', () => {
    const approval = buildApprovalView();
    const noApprovals = { ...approval, signatures: [] };
    const r = assertApplyApproved({ ...base, approval: noApprovals });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/no approving signature/i);
  });
});

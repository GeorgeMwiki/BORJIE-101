import { describe, expect, it } from 'vitest';
import { checkDoubleVerify } from '../approvals/double-verify-guard.js';
import {
  createInMemoryApprovalRepository,
} from '../approvals/approval-repository.js';
import type { ApprovalRecord } from '../types.js';

function approval(
  user: string,
  role: 'owner' | 'second_authoriser',
  atIso: string,
  decision: 'approved' | 'rejected' = 'approved',
): ApprovalRecord {
  return {
    proposal_id: 'p-1',
    approver_user_id: user,
    approver_role: role,
    decision,
    reasoning: 'r',
    decided_at: atIso,
    audit_hash: 'h',
  };
}

describe('checkDoubleVerify', () => {
  it('passes when two distinct users approve > 5 minutes apart', () => {
    const out = checkDoubleVerify([
      approval('alice', 'owner', '2026-05-26T10:00:00.000Z'),
      approval('bob', 'second_authoriser', '2026-05-26T10:06:00.000Z'),
    ]);
    expect(out.ok).toBe(true);
  });

  it('fails when the same user appears in both roles', () => {
    const out = checkDoubleVerify([
      approval('alice', 'owner', '2026-05-26T10:00:00.000Z'),
      approval('alice', 'second_authoriser', '2026-05-26T10:06:00.000Z'),
    ]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('same_user');
  });

  it('fails when cooldown not elapsed', () => {
    const out = checkDoubleVerify([
      approval('alice', 'owner', '2026-05-26T10:00:00.000Z'),
      approval('bob', 'second_authoriser', '2026-05-26T10:02:00.000Z'),
    ]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('cooldown_not_elapsed');
  });

  it('fails when only one role has approved', () => {
    const out = checkDoubleVerify([
      approval('alice', 'owner', '2026-05-26T10:00:00.000Z'),
    ]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('insufficient_approvals');
  });

  it('fails when any rejection is present', () => {
    const out = checkDoubleVerify([
      approval('alice', 'owner', '2026-05-26T10:00:00.000Z'),
      approval('bob', 'second_authoriser', '2026-05-26T10:06:00.000Z', 'rejected'),
    ]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('rejection_present');
  });
});

describe('approval-repository', () => {
  it('rejects same approver_user_id voting twice on the same proposal', async () => {
    const repo = createInMemoryApprovalRepository();
    await repo.save(approval('alice', 'owner', '2026-05-26T10:00:00.000Z'));
    await expect(
      repo.save(approval('alice', 'owner', '2026-05-26T10:30:00.000Z')),
    ).rejects.toThrow(/already decided/);
  });

  it('lists approvals scoped to a proposal id', async () => {
    const repo = createInMemoryApprovalRepository();
    await repo.save(approval('alice', 'owner', '2026-05-26T10:00:00.000Z'));
    await repo.save({
      ...approval('bob', 'second_authoriser', '2026-05-26T10:06:00.000Z'),
    });
    const records = await repo.listForProposal('p-1');
    expect(records).toHaveLength(2);
  });
});

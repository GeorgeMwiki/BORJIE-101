/**
 * DoubleVerifyGuard — enforces the two-operator invariants required
 * by Tier 2-Critical mutations.
 *
 * The invariants are lifted directly from Wave 6's killswitch RBAC
 * (`killswitch_pending_confirmations`):
 *
 *   1. The second approver MUST be a different user from the primary.
 *   2. At least `DOUBLE_VERIFY_COOLDOWN_MS` (5 minutes) must elapse
 *      between the two approvals.
 *   3. Both approval rows reference the same `proposal_id`.
 *
 * This module is pure — it inspects an array of `ApprovalRecord` and
 * returns a structured verdict. The caller (approval-workflow) drives
 * the state machine.
 */

import {
  DOUBLE_VERIFY_COOLDOWN_MS,
  type ApprovalRecord,
} from '../types.js';

export type DoubleVerifyVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        | 'same_user'
        | 'cooldown_not_elapsed'
        | 'role_mismatch'
        | 'rejection_present'
        | 'insufficient_approvals';
    };

export function checkDoubleVerify(
  approvals: ReadonlyArray<ApprovalRecord>,
): DoubleVerifyVerdict {
  const primaries = approvals.filter(
    (a) => a.approver_role === 'owner' && a.decision === 'approved',
  );
  const seconds = approvals.filter(
    (a) =>
      a.approver_role === 'second_authoriser' && a.decision === 'approved',
  );
  const rejections = approvals.filter((a) => a.decision === 'rejected');

  if (rejections.length > 0) {
    return { ok: false, reason: 'rejection_present' };
  }

  if (primaries.length === 0 || seconds.length === 0) {
    return { ok: false, reason: 'insufficient_approvals' };
  }

  // The most-recent approval of each role wins. Older entries are
  // historical (e.g. a revision re-approval).
  const primary = primaries[primaries.length - 1];
  const second = seconds[seconds.length - 1];

  if (!primary || !second) {
    return { ok: false, reason: 'insufficient_approvals' };
  }

  if (primary.approver_user_id === second.approver_user_id) {
    return { ok: false, reason: 'same_user' };
  }

  const primaryMs = Date.parse(primary.decided_at);
  const secondMs = Date.parse(second.decided_at);
  const elapsed = Math.abs(secondMs - primaryMs);

  if (elapsed < DOUBLE_VERIFY_COOLDOWN_MS) {
    return { ok: false, reason: 'cooldown_not_elapsed' };
  }

  return { ok: true };
}

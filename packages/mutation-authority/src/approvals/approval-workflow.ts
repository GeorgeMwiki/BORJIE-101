/**
 * Approval workflow — the state machine that walks a proposal from
 * `pending` to a terminal state.
 *
 * Transitions:
 *
 *   pending ──── tier-0 / tier-1 auto-promote ────────► approved_full
 *   pending ──── owner approve (tier 1 or 2) ─────────► approved_primary
 *   pending ──── owner reject ───────────────────────► rejected
 *   approved_primary ──── auto-finalise (non-critical) ► approved_full
 *   approved_primary ──── second-authoriser approve ──► approved_full (critical)
 *   approved_primary ──── second-authoriser reject ───► rejected
 *   pending|approved_primary ──── expiry-tick ────────► expired
 *
 * The workflow is pure-functional — pass it the current state and an
 * event, get the next state. Persistence is the caller's responsibility.
 */

import { chainHash, GENESIS_HASH } from '@borjie/audit-hash-chain';
import { checkDoubleVerify } from './double-verify-guard.js';
import type {
  ApprovalDecision,
  ApprovalRecord,
  ApproverRole,
  MutationProposal,
  ProposalStatus,
} from '../types.js';

export type WorkflowEvent =
  | {
      readonly kind: 'decide';
      readonly proposalId: string;
      readonly approverUserId: string;
      readonly approverRole: ApproverRole;
      readonly decision: ApprovalDecision;
      readonly reasoning: string;
      readonly decidedAt: string;
    }
  | {
      readonly kind: 'auto_promote';
      readonly proposalId: string;
      readonly atIso: string;
    }
  | {
      readonly kind: 'expire';
      readonly proposalId: string;
      readonly atIso: string;
    };

export type WorkflowOutcome =
  | {
      readonly ok: true;
      readonly nextStatus: ProposalStatus;
      readonly approvalRecord: ApprovalRecord | null;
      readonly readyToExecute: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: string;
    };

export interface ApplyEventArgs {
  readonly proposal: MutationProposal;
  readonly currentStatus: ProposalStatus;
  readonly priorApprovals: ReadonlyArray<ApprovalRecord>;
  readonly event: WorkflowEvent;
  /**
   * Optional user id of the principal who initiated the proposal. When
   * supplied, the workflow refuses any `decide` event whose
   * `approverUserId` matches it — the four-eye rule. Without an
   * initiator id the workflow can only enforce primary != second
   * (the existing check inside `checkDoubleVerify`), which leaves a
   * gap for an admin to self-approve a Tier 1 proposal.
   *
   * Wave 5 adds this field so org-scoped admins cannot rubber-stamp
   * their own mutations even when they nominally hold approve power.
   */
  readonly initiatorUserId?: string;
}

export function applyEvent(args: ApplyEventArgs): WorkflowOutcome {
  const { proposal, currentStatus, priorApprovals, event, initiatorUserId } =
    args;

  if (
    currentStatus === 'rejected' ||
    currentStatus === 'executed' ||
    currentStatus === 'aborted' ||
    currentStatus === 'expired'
  ) {
    return { ok: false, reason: `terminal_state:${currentStatus}` };
  }

  if (event.kind === 'expire') {
    return {
      ok: true,
      nextStatus: 'expired',
      approvalRecord: null,
      readyToExecute: false,
    };
  }

  // Four-eye rule — the initiator can never approve their own proposal,
  // regardless of role or tier. Catches the case where a delegated
  // admin holds both initiate AND approve capability.
  if (
    event.kind === 'decide' &&
    initiatorUserId !== undefined &&
    event.approverUserId === initiatorUserId
  ) {
    return { ok: false, reason: 'self_approval_forbidden' };
  }

  if (event.kind === 'auto_promote') {
    // Only Tier 0 and Tier 1 may auto-promote, and only when no
    // double-verify is required.
    if (proposal.requires_double_verify) {
      return { ok: false, reason: 'auto_promote_blocked_by_double_verify' };
    }
    if (proposal.authority_tier > 1) {
      return { ok: false, reason: 'auto_promote_blocked_by_tier' };
    }
    return {
      ok: true,
      nextStatus: 'approved_full',
      approvalRecord: null,
      readyToExecute: true,
    };
  }

  // event.kind === 'decide'
  const audit_hash = chainHash({
    prev: GENESIS_HASH,
    payload: {
      kind: 'mutation_approval',
      proposal_id: event.proposalId,
      approver_user_id: event.approverUserId,
      approver_role: event.approverRole,
      decision: event.decision,
      decided_at: event.decidedAt,
    },
  });

  const record: ApprovalRecord = {
    proposal_id: event.proposalId,
    approver_user_id: event.approverUserId,
    approver_role: event.approverRole,
    decision: event.decision,
    reasoning: event.reasoning,
    decided_at: event.decidedAt,
    audit_hash,
  };

  if (event.decision === 'rejected') {
    return {
      ok: true,
      nextStatus: 'rejected',
      approvalRecord: record,
      readyToExecute: false,
    };
  }

  // Approval. Different transitions depending on role + tier.
  if (event.approverRole === 'owner') {
    // Owner approval moves to approved_primary; if the proposal is
    // non-critical, primary IS final.
    if (!proposal.requires_double_verify) {
      return {
        ok: true,
        nextStatus: 'approved_full',
        approvalRecord: record,
        readyToExecute: true,
      };
    }
    return {
      ok: true,
      nextStatus: 'approved_primary',
      approvalRecord: record,
      readyToExecute: false,
    };
  }

  // second_authoriser — only valid if we are currently approved_primary
  if (currentStatus !== 'approved_primary') {
    return {
      ok: false,
      reason: 'second_authoriser_before_owner_approval',
    };
  }

  const combined = [...priorApprovals, record];
  const verdict = checkDoubleVerify(combined);
  if (!verdict.ok) {
    return { ok: false, reason: `double_verify_failed:${verdict.reason}` };
  }

  return {
    ok: true,
    nextStatus: 'approved_full',
    approvalRecord: record,
    readyToExecute: true,
  };
}

/**
 * Tier-2 approval workflow — moves a freshly composed Tier-2 artifact
 * from `pending` to `approved` / `rejected` per spec §8. Tier-1
 * artifacts may auto-publish via `markAutoPublished`.
 *
 * Pure functions. The caller persists the resulting artifact and
 * emits the audit-chain entry.
 */

import type { ApprovalState, AuthorityTier, DocumentArtifact } from '../types.js';
import { CompositionError } from '../types.js';

/**
 * Determine the initial approval state for a newly composed artifact.
 * Tier 2 → 'pending' (owner must approve before send).
 * Tier 0 / 1 → 'auto_published' (passive notification path).
 */
export function initialApprovalState(tier: AuthorityTier): ApprovalState {
  return tier === 2 ? 'pending' : 'auto_published';
}

export interface ApproveArgs {
  readonly artifact: DocumentArtifact;
  readonly approver_id: string;
  readonly approved_at?: string;
}

export function approveArtifact(args: ApproveArgs): DocumentArtifact {
  if (args.artifact.approval_state !== 'pending') {
    throw new CompositionError(
      'STATE_TRANSITION_REFUSED',
      `cannot approve artifact in state ${args.artifact.approval_state}`,
      [args.artifact.id, args.artifact.approval_state],
    );
  }
  return {
    ...args.artifact,
    approval_state: 'approved',
    approved_by: args.approver_id,
    approved_at: args.approved_at ?? new Date().toISOString(),
  };
}

export interface RejectArgs {
  readonly artifact: DocumentArtifact;
  readonly rejector_id: string;
  readonly rejected_at?: string;
}

export function rejectArtifact(args: RejectArgs): DocumentArtifact {
  if (args.artifact.approval_state !== 'pending') {
    throw new CompositionError(
      'STATE_TRANSITION_REFUSED',
      `cannot reject artifact in state ${args.artifact.approval_state}`,
      [args.artifact.id, args.artifact.approval_state],
    );
  }
  return {
    ...args.artifact,
    approval_state: 'rejected',
    approved_by: args.rejector_id,
    approved_at: args.rejected_at ?? new Date().toISOString(),
  };
}

/**
 * Mark a Tier-1 artifact as auto-published. Refuses to demote a
 * pending Tier-2 artifact into auto-publication.
 */
export function markAutoPublished(artifact: DocumentArtifact): DocumentArtifact {
  if (artifact.approval_state === 'approved' || artifact.approval_state === 'rejected') {
    throw new CompositionError(
      'STATE_TRANSITION_REFUSED',
      `cannot auto-publish artifact in state ${artifact.approval_state}`,
      [artifact.id, artifact.approval_state],
    );
  }
  if (artifact.approval_state === 'pending') {
    throw new CompositionError(
      'STATE_TRANSITION_REFUSED',
      'tier-2 artifact requires explicit owner approval',
      [artifact.id],
    );
  }
  return { ...artifact, approval_state: 'auto_published' };
}

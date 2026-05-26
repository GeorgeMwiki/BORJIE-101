/**
 * Audit-chain link — binds a (proposal, approvals, result) triple to
 * the audit hash chain.
 *
 * Each transition writes ONE entry: proposal-composed, approval-recorded,
 * mutation-executed (or failed / aborted), rollback-applied. The
 * append-and-verify primitives come from `@borjie/audit-hash-chain`.
 *
 * The caller persists the chain rows — this module is pure-functional
 * and never performs I/O.
 */

import {
  appendEntry,
  type AuditPayload,
  type ChainEntry,
} from '@borjie/audit-hash-chain';
import type {
  ApprovalRecord,
  MutationProposal,
  MutationResult,
} from '../types.js';

export type MutationAuditEvent =
  | { readonly kind: 'composed'; readonly proposal: MutationProposal }
  | { readonly kind: 'approval'; readonly approval: ApprovalRecord }
  | { readonly kind: 'executed'; readonly result: MutationResult }
  | { readonly kind: 'rolled_back'; readonly proposalId: string; readonly atIso: string };

function payloadFor(event: MutationAuditEvent): AuditPayload {
  if (event.kind === 'composed') {
    return {
      kind: 'mutation_proposal_composed',
      proposal_id: event.proposal.id,
      recipe_id: event.proposal.recipe_id,
      recipe_version: event.proposal.recipe_version,
      tenant_id: event.proposal.tenant_id,
      proposed_by: event.proposal.proposed_by,
      proposed_at: event.proposal.proposed_at,
      authority_tier: event.proposal.authority_tier,
      requires_double_verify: event.proposal.requires_double_verify,
      audit_hash: event.proposal.audit_hash,
    };
  }
  if (event.kind === 'approval') {
    return {
      kind: 'mutation_approval_recorded',
      proposal_id: event.approval.proposal_id,
      approver_user_id: event.approval.approver_user_id,
      approver_role: event.approval.approver_role,
      decision: event.approval.decision,
      decided_at: event.approval.decided_at,
      audit_hash: event.approval.audit_hash,
    };
  }
  if (event.kind === 'executed') {
    return {
      kind: 'mutation_executed',
      proposal_id: event.result.proposal_id,
      status: event.result.status,
      executed_at: event.result.executed_at,
      audit_hash: event.result.audit_hash,
    };
  }
  return {
    kind: 'mutation_rolled_back',
    proposal_id: event.proposalId,
    at: event.atIso,
  };
}

export function appendMutationAudit(
  chain: ReadonlyArray<ChainEntry>,
  event: MutationAuditEvent,
): ReadonlyArray<ChainEntry> {
  return appendEntry(chain, payloadFor(event));
}

/**
 * promotion — owner approves a pending proposal -> new recipe version
 * goes live and the proposal row is closed.
 *
 * Spec §3 + §7: "A live recipe never mutates in place — improvement
 * proposals create version n+1 in `shadow` state, which is promoted to
 * `live` only after owner approval."
 *
 * Concrete sequence:
 *   1. Look up the proposal row; must be `pending`.
 *   2. Mark current live version as `deprecated`.
 *   3. Insert version n+1 as `live` (copying the static fields from
 *      the parent recipe; the proposed_diff describes what changed but
 *      the recipe row itself only carries the metadata).
 *   4. Mark the proposal as `approved` + record the audit hash.
 *   5. Emit a `doc_evo.proposal_promotion` audit entry.
 */

import type { ChainEntry } from '@borjie/audit-hash-chain';
import type {
  DocEvolutionProposalRow,
} from '../types.js';
import type { ProposalRepository } from '../storage/proposal-repository.js';
import type { RecipeRepository } from '../storage/recipe-repository.js';
import { emitAuditEntry } from '../audit/audit-emit.js';

export interface PromotionDeps {
  readonly proposals: ProposalRepository;
  readonly recipes: RecipeRepository;
  readonly auditChain?: ReadonlyArray<ChainEntry>;
  readonly auditSecretId?: string;
  readonly auditSecretValue?: string;
}

export interface PromoteInput {
  readonly proposal_id: string;
  readonly reviewer_user_id: string;
  readonly reviewer_reason: string | null;
}

export interface PromoteResult {
  readonly proposal: DocEvolutionProposalRow;
  readonly newLiveVersion: number;
  readonly auditChain: ReadonlyArray<ChainEntry>;
}

export async function promoteProposal(
  deps: PromotionDeps,
  input: PromoteInput,
): Promise<PromoteResult> {
  const proposal = await deps.proposals.findById(input.proposal_id);
  if (proposal === null) {
    throw new Error(`promotion: proposal not found ${input.proposal_id}`);
  }
  if (proposal.status !== 'pending') {
    throw new Error(
      `promotion: refused, proposal status is ${proposal.status} not pending`,
    );
  }

  // Find the parent live row so we can copy its static fields.
  const currentLive = await deps.recipes.findById(
    proposal.recipe_id,
    proposal.current_version,
  );
  if (currentLive === null) {
    throw new Error(
      `promotion: current live recipe row missing ${proposal.recipe_id}@${proposal.current_version}`,
    );
  }

  // Mark current live as deprecated.
  await deps.recipes.updateStatus(
    proposal.recipe_id,
    proposal.current_version,
    'deprecated',
    null,
  );

  // Insert n+1 as live.
  await deps.recipes.insertNewVersion({
    id: proposal.recipe_id,
    version: proposal.proposed_version,
    status: 'live',
    class: currentLive.class,
    compose_fn_ref: currentLive.compose_fn_ref,
    required_inputs: currentLive.required_inputs,
    required_citations: currentLive.required_citations,
    output_formats: currentLive.output_formats,
    authority_tier: currentLive.authority_tier,
    approval_required: currentLive.approval_required,
    promoted_by: input.reviewer_user_id,
  });

  // Mark the new row as live in case `insertNewVersion` no-op'd on a
  // pre-existing draft/shadow row.
  await deps.recipes.updateStatus(
    proposal.recipe_id,
    proposal.proposed_version,
    'live',
    input.reviewer_user_id,
  );

  // Emit audit entry.
  const audit = emitAuditEntry({
    kind: 'doc_evo.proposal_promotion',
    tenant_id: proposal.tenant_id,
    subject: {
      proposal_id: proposal.id,
      recipe_id: proposal.recipe_id,
      from_version: proposal.current_version,
      to_version: proposal.proposed_version,
      reviewer_user_id: input.reviewer_user_id,
    },
    chain: deps.auditChain ?? [],
    ...(deps.auditSecretId !== undefined
      ? { secret_id: deps.auditSecretId }
      : {}),
    ...(deps.auditSecretValue !== undefined
      ? { secret_value: deps.auditSecretValue }
      : {}),
  });

  // Close the proposal row.
  await deps.proposals.markReviewed({
    proposal_id: proposal.id,
    status: 'approved',
    reviewed_by: input.reviewer_user_id,
    reviewer_reason: input.reviewer_reason,
    approval_audit_hash: audit.entry.rowHash,
  });

  return {
    proposal,
    newLiveVersion: proposal.proposed_version,
    auditChain: audit.chain,
  };
}

/**
 * Owner rejected the proposal — close the row, no recipe change.
 */
export async function rejectProposal(
  deps: PromotionDeps,
  input: PromoteInput,
): Promise<{
  readonly auditChain: ReadonlyArray<ChainEntry>;
}> {
  const proposal = await deps.proposals.findById(input.proposal_id);
  if (proposal === null) {
    throw new Error(`promotion: proposal not found ${input.proposal_id}`);
  }
  if (proposal.status !== 'pending') {
    throw new Error(
      `promotion: refused, proposal status is ${proposal.status} not pending`,
    );
  }
  const audit = emitAuditEntry({
    kind: 'doc_evo.proposal_review',
    tenant_id: proposal.tenant_id,
    subject: {
      proposal_id: proposal.id,
      recipe_id: proposal.recipe_id,
      action: 'rejected',
      reviewer_user_id: input.reviewer_user_id,
      reason: input.reviewer_reason ?? null,
    },
    chain: deps.auditChain ?? [],
    ...(deps.auditSecretId !== undefined
      ? { secret_id: deps.auditSecretId }
      : {}),
    ...(deps.auditSecretValue !== undefined
      ? { secret_value: deps.auditSecretValue }
      : {}),
  });
  await deps.proposals.markReviewed({
    proposal_id: proposal.id,
    status: 'rejected',
    reviewed_by: input.reviewer_user_id,
    reviewer_reason: input.reviewer_reason,
    approval_audit_hash: audit.entry.rowHash,
  });
  return { auditChain: audit.chain };
}

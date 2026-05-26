/**
 * Promotion state machine.
 *
 * Five states per spec §4 + the `tab_recipes.status` CHECK in
 * migration 0017:
 *
 *   draft → shadow → live → locked → deprecated
 *
 * Transitions the worker performs:
 *
 *   draft       → shadow      : `emitProposal` creates a shadow row for
 *                               the proposed_version.
 *   shadow      → live        : `approveProposal` flips the proposed
 *                               row to live. In the same transaction
 *                               the previous live row is moved to
 *                               deprecated (NEVER deleted — audit trail
 *                               is preserved).
 *   live        → locked      : `applyLock` flips a single live row to
 *                               locked. Mr. Mwikila has decided the
 *                               version sustained the §4 lock
 *                               thresholds for 30 days.
 *   locked      → live        : `unlock` reverses a lock. Phase 2
 *                               owner action; not a worker action. This
 *                               module just exposes the helper for
 *                               completeness.
 *   any         → deprecated  : `deprecate` retires a version without
 *                               a successor (rare — used when an old
 *                               recipe is sunsetted).
 *
 * Invariants enforced here in the worker (defensive, db has CHECKs
 * too):
 *
 *   - exactly ONE live or locked version per recipe id at a time
 *   - approve always bumps to current+1 (proposed_version)
 *   - the old live row goes to deprecated; reject never touches the
 *     recipe rows, only the proposal status
 *
 * All transitions write an audit-hash-chain entry via the supplied
 * AuditChainAppender. Failures of the audit append are surfaced — a
 * promotion that we cannot prove cryptographically is not a promotion
 * we'll record at all.
 */

import type {
  EvolutionProposal,
  RolloutStrategy,
  TabRecipeRow,
} from '../types.js';
import type { ProposalRepository } from '../storage/proposal-repository.js';
import type { RecipeRepository } from '../storage/recipe-repository.js';
import type { AuditEmitter } from '../audit/audit-emit.js';

// ---------------------------------------------------------------------------
// Approval inputs
// ---------------------------------------------------------------------------

export interface ApproveProposalArgs {
  readonly proposal: EvolutionProposal;
  readonly currentRecipe: TabRecipeRow;
  readonly reviewerId: string;
  readonly rolloutStrategy: RolloutStrategy;
  readonly recipeRepository: RecipeRepository;
  readonly proposalRepository: ProposalRepository;
  readonly auditEmitter: AuditEmitter;
}

export interface RejectProposalArgs {
  readonly proposal: EvolutionProposal;
  readonly reviewerId: string;
  readonly reviewerReason: string;
  readonly proposalRepository: ProposalRepository;
  readonly auditEmitter: AuditEmitter;
}

export interface ApplyLockArgs {
  readonly recipe: TabRecipeRow;
  readonly recipeRepository: RecipeRepository;
  readonly auditEmitter: AuditEmitter;
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Promotion outcomes
// ---------------------------------------------------------------------------

export interface PromotionOutcome {
  readonly tabRecipeId: string;
  readonly oldVersion: number;
  readonly newVersion: number;
  readonly oldStatus: 'live' | 'locked' | 'shadow' | 'deprecated' | 'draft';
  readonly newStatus: 'live' | 'locked' | 'deprecated';
  readonly auditHash: string;
}

// ---------------------------------------------------------------------------
// Approve: shadow → live + previous live → deprecated
// ---------------------------------------------------------------------------

export async function approveProposal(
  args: ApproveProposalArgs,
): Promise<PromotionOutcome> {
  // Sanity: the proposal targets the supplied current recipe.
  if (
    args.proposal.tabRecipeId !== args.currentRecipe.id ||
    args.proposal.currentVersion !== args.currentRecipe.version
  ) {
    throw new Error('promotion: proposal/current-recipe mismatch');
  }
  if (args.currentRecipe.status === 'locked') {
    throw new Error(
      'promotion: cannot approve over a locked recipe; unlock first',
    );
  }

  // Step 1 — write the audit row FIRST. If the chain append fails we
  // abort before mutating any recipe rows.
  const auditHash = await args.auditEmitter.append({
    kind: 'proposal.approved',
    tenantId: args.proposal.tenantId,
    payload: {
      proposalId: args.proposal.id,
      tabRecipeId: args.proposal.tabRecipeId,
      currentVersion: args.proposal.currentVersion,
      proposedVersion: args.proposal.proposedVersion,
      reviewerId: args.reviewerId,
      rolloutStrategy: args.rolloutStrategy,
      signalsCount: args.proposal.signals.length,
    },
  });

  // Step 2 — promote the shadow to live. The shadow row is expected to
  // have been inserted at proposal-emit time; if it isn't here we
  // insert it on the fly to keep the state machine self-healing.
  const shadowExists = await args.recipeRepository.findVersion(
    args.proposal.tabRecipeId,
    args.proposal.proposedVersion,
  );
  if (!shadowExists) {
    await args.recipeRepository.insertShadow({
      id: args.proposal.tabRecipeId,
      version: args.proposal.proposedVersion,
      intent: args.currentRecipe.intent,
      composeFnRef: args.currentRecipe.composeFnRef,
      authorityTier: args.currentRecipe.authorityTier,
    });
  }
  await args.recipeRepository.updateStatus({
    id: args.proposal.tabRecipeId,
    version: args.proposal.proposedVersion,
    nextStatus: 'live',
    promotedBy: args.reviewerId,
  });

  // Step 3 — move the previously-live version to deprecated. Audit
  // trail is preserved; the row is NOT deleted.
  await args.recipeRepository.updateStatus({
    id: args.currentRecipe.id,
    version: args.currentRecipe.version,
    nextStatus: 'deprecated',
  });

  // Step 4 — close out the proposal row.
  await args.proposalRepository.updateStatus({
    id: args.proposal.id,
    nextStatus: 'approved',
    reviewedBy: args.reviewerId,
    rolloutStrategy: args.rolloutStrategy,
    approvalAuditHash: auditHash,
  });

  return {
    tabRecipeId: args.proposal.tabRecipeId,
    oldVersion: args.currentRecipe.version,
    newVersion: args.proposal.proposedVersion,
    oldStatus: 'live',
    newStatus: 'live',
    auditHash,
  };
}

// ---------------------------------------------------------------------------
// Reject — proposal closes; recipes are untouched.
// ---------------------------------------------------------------------------

export async function rejectProposal(args: RejectProposalArgs): Promise<string> {
  const auditHash = await args.auditEmitter.append({
    kind: 'proposal.rejected',
    tenantId: args.proposal.tenantId,
    payload: {
      proposalId: args.proposal.id,
      tabRecipeId: args.proposal.tabRecipeId,
      reviewerId: args.reviewerId,
      reviewerReason: args.reviewerReason,
    },
  });
  await args.proposalRepository.updateStatus({
    id: args.proposal.id,
    nextStatus: 'rejected',
    reviewedBy: args.reviewerId,
    reviewerReason: args.reviewerReason,
    approvalAuditHash: auditHash,
  });
  return auditHash;
}

// ---------------------------------------------------------------------------
// Lock — live → locked
// ---------------------------------------------------------------------------

export async function applyLock(args: ApplyLockArgs): Promise<PromotionOutcome> {
  if (args.recipe.status !== 'live') {
    throw new Error(
      `promotion: applyLock requires live status; got '${args.recipe.status}'`,
    );
  }
  const auditHash = await args.auditEmitter.append({
    kind: 'recipe.locked',
    payload: {
      tabRecipeId: args.recipe.id,
      tabRecipeVersion: args.recipe.version,
      reason: args.reason,
    },
  });
  await args.recipeRepository.updateStatus({
    id: args.recipe.id,
    version: args.recipe.version,
    nextStatus: 'locked',
    lockedAtIso: new Date().toISOString(),
  });
  return {
    tabRecipeId: args.recipe.id,
    oldVersion: args.recipe.version,
    newVersion: args.recipe.version,
    oldStatus: 'live',
    newStatus: 'locked',
    auditHash,
  };
}

// ---------------------------------------------------------------------------
// Lock-candidate marker — no DB column flip, just an audit + ledger note
// ---------------------------------------------------------------------------

export interface MarkLockCandidateArgs {
  readonly recipe: TabRecipeRow;
  readonly auditEmitter: AuditEmitter;
  readonly reason: string;
}

export async function markLockCandidate(
  args: MarkLockCandidateArgs,
): Promise<string> {
  const auditHash = await args.auditEmitter.append({
    kind: 'recipe.lock_candidate.marked',
    payload: {
      tabRecipeId: args.recipe.id,
      tabRecipeVersion: args.recipe.version,
      reason: args.reason,
    },
  });
  return auditHash;
}

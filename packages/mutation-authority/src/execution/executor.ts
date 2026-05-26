/**
 * Executor — invokes `recipe.execute(proposal, approvals)` once the
 * proposal reaches `approved_full`.
 *
 * The executor is intentionally thin: the recipe owns its side-effect
 * surface. The executor's responsibility is:
 *
 *   1. Refuse to execute if the workflow gate has not passed.
 *   2. Catch and structure errors.
 *   3. Append the result to `mutation_history` via the injected
 *      history-repository.
 *   4. Surface the audit hash bound to (proposal_hash, approval_hashes,
 *      result_hash) so the audit-chain-link module can append.
 */

import { chainHash, GENESIS_HASH } from '@borjie/audit-hash-chain';
import type {
  ApprovalRecord,
  MutationProposal,
  MutationRecipe,
  MutationResult,
} from '../types.js';
import type { HistoryRepository } from './history-repository.js';

export interface ExecutorArgs {
  readonly recipe: MutationRecipe;
  readonly proposal: MutationProposal;
  readonly approvals: ReadonlyArray<ApprovalRecord>;
  readonly history: HistoryRepository;
  readonly nowIso?: () => string;
}

export interface ExecutionOutcome {
  readonly result: MutationResult;
  readonly chainPayload: Readonly<Record<string, unknown>>;
}

export async function executeMutation(
  args: ExecutorArgs,
): Promise<ExecutionOutcome> {
  const { recipe, proposal, approvals, history } = args;
  const nowIso = args.nowIso ?? (() => new Date().toISOString());

  // Belt + braces — caller is supposed to have advanced state to
  // `approved_full`, but the executor refuses if the approval set
  // doesn't satisfy the recipe's gate.
  if (recipe.is_critical || proposal.requires_double_verify) {
    const ownerOk = approvals.some(
      (a) => a.approver_role === 'owner' && a.decision === 'approved',
    );
    const secondOk = approvals.some(
      (a) =>
        a.approver_role === 'second_authoriser' && a.decision === 'approved',
    );
    if (!ownerOk || !secondOk) {
      const failed: MutationResult = {
        proposal_id: proposal.id,
        status: 'aborted',
        executed_at: nowIso(),
        rollback_token: null,
        side_effects_summary: 'aborted_due_to_missing_double_verify',
        downstream_artifacts: [],
        audit_hash: chainHash({
          prev: GENESIS_HASH,
          payload: { kind: 'mutation_aborted', proposal_id: proposal.id },
        }),
      };
      await history.save(failed);
      return {
        result: failed,
        chainPayload: { kind: 'mutation_aborted', proposal_id: proposal.id },
      };
    }
  }

  try {
    const result = await recipe.execute(proposal, approvals);
    await history.save(result);
    return {
      result,
      chainPayload: {
        kind: 'mutation_executed',
        proposal_id: result.proposal_id,
        status: result.status,
        executed_at: result.executed_at,
        downstream_artifacts: result.downstream_artifacts,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'recipe_execute_failed';
    const failed: MutationResult = {
      proposal_id: proposal.id,
      status: 'failed',
      executed_at: nowIso(),
      rollback_token: null,
      side_effects_summary: `recipe_threw:${message}`,
      downstream_artifacts: [],
      audit_hash: chainHash({
        prev: GENESIS_HASH,
        payload: {
          kind: 'mutation_failed',
          proposal_id: proposal.id,
          message,
        },
      }),
    };
    await history.save(failed);
    return {
      result: failed,
      chainPayload: {
        kind: 'mutation_failed',
        proposal_id: proposal.id,
        message,
      },
    };
  }
}

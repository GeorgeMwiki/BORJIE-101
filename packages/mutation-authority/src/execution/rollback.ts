/**
 * Rollback — for `reversibility: 'fully'` mutations, mint and consume
 * an opaque rollback token.
 *
 * The token is generated server-side; the client receives an opaque
 * handle (the proposal id) and never sees the raw token. The token's
 * presence in `mutation_history.rollback_token` is the gate — once
 * consumed (set to NULL), rollback is no longer possible.
 */

import { chainHash, GENESIS_HASH } from '@borjie/audit-hash-chain';
import type { MutationResult, Reversibility } from '../types.js';

export interface RollbackArgs {
  readonly result: MutationResult;
  readonly reversibility: Reversibility;
  readonly rollbackFn: (
    artifacts: ReadonlyArray<{ kind: string; id: string }>,
  ) => Promise<{ readonly summary: string }>;
  readonly nowIso?: () => string;
}

export type RollbackOutcome =
  | {
      readonly ok: true;
      readonly summary: string;
      readonly atIso: string;
      readonly audit_hash: string;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'not_reversible'
        | 'token_consumed'
        | 'not_executed'
        | 'rollback_threw';
      readonly message?: string;
    };

export async function rollbackMutation(
  args: RollbackArgs,
): Promise<RollbackOutcome> {
  const { result, reversibility } = args;
  const nowIso = args.nowIso ?? (() => new Date().toISOString());

  if (reversibility !== 'fully') {
    return { ok: false, reason: 'not_reversible' };
  }
  if (result.status !== 'executed') {
    return { ok: false, reason: 'not_executed' };
  }
  if (result.rollback_token === null) {
    return { ok: false, reason: 'token_consumed' };
  }

  try {
    const { summary } = await args.rollbackFn(result.downstream_artifacts);
    const atIso = nowIso();
    const audit_hash = chainHash({
      prev: GENESIS_HASH,
      payload: {
        kind: 'mutation_rollback',
        proposal_id: result.proposal_id,
        at: atIso,
        summary,
      },
    });
    return { ok: true, summary, atIso, audit_hash };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'rollback_fn_failed';
    return { ok: false, reason: 'rollback_threw', message };
  }
}

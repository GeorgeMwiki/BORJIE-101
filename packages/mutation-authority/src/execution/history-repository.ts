/**
 * History repository — append-only `mutation_history` writer.
 *
 * The history table is the terminal artefact of every mutation —
 * caller cannot re-write entries. The in-memory impl mirrors the
 * append-only constraint by refusing to overwrite an existing
 * `proposal_id` row.
 */

import type { MutationResult } from '../types.js';

export interface HistoryRepository {
  readonly save: (result: MutationResult) => Promise<MutationResult>;
  readonly findByProposalId: (
    proposalId: string,
  ) => Promise<MutationResult | null>;
}

export function createInMemoryHistoryRepository(): HistoryRepository {
  let store: ReadonlyArray<MutationResult> = [];

  return {
    async save(result) {
      const conflict = store.find((r) => r.proposal_id === result.proposal_id);
      if (conflict) {
        throw new Error(
          `mutation-authority: history for proposal ${result.proposal_id} already written (append-only)`,
        );
      }
      store = [...store, result];
      return result;
    },
    async findByProposalId(proposalId) {
      return store.find((r) => r.proposal_id === proposalId) ?? null;
    },
  };
}

/**
 * Approval repository — CRUD on `mutation_approvals`.
 *
 * Mirrors `proposal-repository.ts` — interface + in-memory impl for
 * tests; production wiring lives in `@borjie/database`.
 */

import type { ApprovalRecord } from '../types.js';

export interface ApprovalRepository {
  readonly save: (record: ApprovalRecord) => Promise<ApprovalRecord>;
  readonly listForProposal: (
    proposalId: string,
  ) => Promise<ReadonlyArray<ApprovalRecord>>;
}

export function createInMemoryApprovalRepository(): ApprovalRepository {
  let store: ReadonlyArray<ApprovalRecord> = [];

  return {
    async save(record) {
      // Mirror the SQL `UNIQUE (proposal_id, approver_user_id)`
      // constraint defensively: in tests we want the same error
      // surface so the workflow's same-user check fires.
      const conflict = store.find(
        (r) =>
          r.proposal_id === record.proposal_id &&
          r.approver_user_id === record.approver_user_id,
      );
      if (conflict) {
        throw new Error(
          `mutation-authority: approver ${record.approver_user_id} already decided on proposal ${record.proposal_id}`,
        );
      }
      store = [...store, record];
      return record;
    },
    async listForProposal(proposalId) {
      return store.filter((r) => r.proposal_id === proposalId);
    },
  };
}

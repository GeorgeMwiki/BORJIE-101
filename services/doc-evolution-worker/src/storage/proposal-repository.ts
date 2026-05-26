/**
 * proposal-repository — CRUD on `doc_evolution_proposals`.
 *
 * Tenant-scoped. Used by the proposal-emitter to enqueue improvement
 * proposals and by the promotion flow to mark an approved proposal as
 * `approved` once a new recipe version goes live.
 */

import type {
  DocEvolutionProposalRow,
  ProposalStatus,
  ProposedDiff,
} from '../types.js';
import type { SqlPort } from './recipe-repository.js';

export interface ProposalRepository {
  insertPending(args: InsertProposalArgs): Promise<DocEvolutionProposalRow>;
  listPendingForRecipe(args: {
    readonly recipe_id: string;
  }): Promise<ReadonlyArray<DocEvolutionProposalRow>>;
  markReviewed(args: {
    readonly proposal_id: string;
    readonly status: Exclude<ProposalStatus, 'pending'>;
    readonly reviewed_by: string | null;
    readonly reviewer_reason: string | null;
    readonly approval_audit_hash: string | null;
  }): Promise<void>;
  findById(id: string): Promise<DocEvolutionProposalRow | null>;
}

export interface InsertProposalArgs {
  readonly tenant_id: string;
  readonly recipe_id: string;
  readonly current_version: number;
  readonly proposed_version: number;
  readonly proposed_diff: ProposedDiff;
  readonly signals: Readonly<Record<string, unknown>>;
  readonly citations: ReadonlyArray<string>;
}

export function createProposalRepository(sql: SqlPort): ProposalRepository {
  return {
    async insertPending(args) {
      const rows = await sql<DocEvolutionProposalRow>`
        insert into doc_evolution_proposals (
          tenant_id, recipe_id, current_version, proposed_version,
          proposed_diff, signals, citations, status
        )
        values (
          ${args.tenant_id}, ${args.recipe_id},
          ${args.current_version}, ${args.proposed_version},
          ${JSON.stringify(args.proposed_diff)}::jsonb,
          ${JSON.stringify(args.signals)}::jsonb,
          ${args.citations as ReadonlyArray<string> as unknown as string[]},
          'pending'
        )
        returning id, tenant_id, recipe_id, current_version, proposed_version,
                  proposed_diff, signals, citations, status, proposed_at,
                  reviewed_at, reviewed_by, reviewer_reason, approval_audit_hash
      `;
      const row = rows[0];
      if (row === undefined) {
        throw new Error('proposal-repository: insert returned no row');
      }
      return row;
    },
    async listPendingForRecipe(args) {
      return sql<DocEvolutionProposalRow>`
        select id, tenant_id, recipe_id, current_version, proposed_version,
               proposed_diff, signals, citations, status, proposed_at,
               reviewed_at, reviewed_by, reviewer_reason, approval_audit_hash
        from doc_evolution_proposals
        where recipe_id = ${args.recipe_id} and status = 'pending'
        order by proposed_at desc
      `;
    },
    async markReviewed(args) {
      await sql`
        update doc_evolution_proposals
        set status = ${args.status},
            reviewed_at = now(),
            reviewed_by = ${args.reviewed_by},
            reviewer_reason = ${args.reviewer_reason},
            approval_audit_hash = ${args.approval_audit_hash}
        where id = ${args.proposal_id}
      `;
    },
    async findById(id) {
      const rows = await sql<DocEvolutionProposalRow>`
        select id, tenant_id, recipe_id, current_version, proposed_version,
               proposed_diff, signals, citations, status, proposed_at,
               reviewed_at, reviewed_by, reviewer_reason, approval_audit_hash
        from doc_evolution_proposals
        where id = ${id}
        limit 1
      `;
      return rows[0] ?? null;
    },
  };
}

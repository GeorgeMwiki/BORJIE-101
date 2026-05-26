/**
 * promotion.test — owner approves a pending proposal → new recipe
 * version goes live; previous live → deprecated; proposal marked
 * approved with the audit hash.
 *
 * Also covers `rejectProposal` happy path + the refusal on
 * non-pending proposals.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  promoteProposal,
  rejectProposal,
} from '../approval/promotion.js';
import type { ProposalRepository } from '../storage/proposal-repository.js';
import type {
  NewRecipeVersionArgs,
  RecipeRepository,
} from '../storage/recipe-repository.js';
import type {
  DocEvolutionProposalRow,
  DocumentRecipeRow,
  ProposalStatus,
  RecipeStatus,
} from '../types.js';

function makeProposalRow(
  overrides: Partial<DocEvolutionProposalRow>,
): DocEvolutionProposalRow {
  return {
    id: overrides.id ?? 'prop-1',
    tenant_id: overrides.tenant_id ?? 't1',
    recipe_id: overrides.recipe_id ?? 'tumemadini_monthly_return',
    current_version: overrides.current_version ?? 1,
    proposed_version: overrides.proposed_version ?? 2,
    proposed_diff: overrides.proposed_diff ?? {
      recipe_id: 'tumemadini_monthly_return',
      current_version: 1,
      proposed_version: 2,
      summary: 'Improve assays section.',
      edits: [],
    },
    signals: overrides.signals ?? {},
    citations: overrides.citations ?? [],
    status: overrides.status ?? 'pending',
    proposed_at: overrides.proposed_at ?? '2026-05-01T10:00:00Z',
    reviewed_at: overrides.reviewed_at ?? null,
    reviewed_by: overrides.reviewed_by ?? null,
    reviewer_reason: overrides.reviewer_reason ?? null,
    approval_audit_hash: overrides.approval_audit_hash ?? null,
  };
}

function makeRecipeRow(
  overrides: Partial<DocumentRecipeRow>,
): DocumentRecipeRow {
  return {
    id: overrides.id ?? 'tumemadini_monthly_return',
    version: overrides.version ?? 1,
    status: overrides.status ?? 'live',
    class: overrides.class ?? 'tumemadini_return',
    compose_fn_ref: overrides.compose_fn_ref ?? 'doc.tumemadini_v1',
    required_inputs: overrides.required_inputs ?? [],
    required_citations: overrides.required_citations ?? [],
    output_formats: overrides.output_formats ?? ['pdf'],
    authority_tier: overrides.authority_tier ?? 2,
    brand: 'borjie',
    approval_required: overrides.approval_required ?? true,
    promoted_at: overrides.promoted_at ?? null,
    promoted_by: overrides.promoted_by ?? null,
    locked_at: overrides.locked_at ?? null,
    created_at: overrides.created_at ?? '2026-04-01T00:00:00Z',
    updated_at: overrides.updated_at ?? '2026-04-01T00:00:00Z',
  };
}

interface ProposalRepoSpyState {
  marked: Array<{
    proposal_id: string;
    status: Exclude<ProposalStatus, 'pending'>;
    reviewed_by: string | null;
    reviewer_reason: string | null;
    approval_audit_hash: string | null;
  }>;
  rows: Map<string, DocEvolutionProposalRow>;
}

function makeProposalRepo(
  initial: DocEvolutionProposalRow,
): { repo: ProposalRepository; state: ProposalRepoSpyState } {
  const state: ProposalRepoSpyState = {
    marked: [],
    rows: new Map([[initial.id, initial]]),
  };
  const repo: ProposalRepository = {
    async insertPending() {
      throw new Error('not used in promotion tests');
    },
    async listPendingForRecipe() {
      return [];
    },
    async markReviewed(args) {
      state.marked.push(args);
      const cur = state.rows.get(args.proposal_id);
      if (cur === undefined) return;
      state.rows.set(args.proposal_id, {
        ...cur,
        status: args.status,
        reviewed_by: args.reviewed_by,
        reviewer_reason: args.reviewer_reason,
        approval_audit_hash: args.approval_audit_hash,
      });
    },
    async findById(id) {
      return state.rows.get(id) ?? null;
    },
  };
  return { repo, state };
}

interface RecipeRepoSpyState {
  statusUpdates: Array<{
    id: string;
    version: number;
    status: RecipeStatus;
    promotedBy: string | null;
  }>;
  inserts: NewRecipeVersionArgs[];
  rows: Map<string, DocumentRecipeRow>;
}

function key(id: string, version: number): string {
  return `${id}@${version}`;
}

function makeRecipeRepo(
  initial: ReadonlyArray<DocumentRecipeRow>,
): { repo: RecipeRepository; state: RecipeRepoSpyState } {
  const state: RecipeRepoSpyState = {
    statusUpdates: [],
    inserts: [],
    rows: new Map(initial.map((r) => [key(r.id, r.version), r])),
  };
  const repo: RecipeRepository = {
    async listLive() {
      return Array.from(state.rows.values()).filter((r) => r.status === 'live');
    },
    async listByStatus(status) {
      return Array.from(state.rows.values()).filter((r) => r.status === status);
    },
    async findById(id, version) {
      return state.rows.get(key(id, version)) ?? null;
    },
    async updateStatus(id, version, status, promotedBy) {
      state.statusUpdates.push({ id, version, status, promotedBy });
      const cur = state.rows.get(key(id, version));
      if (cur === undefined) return;
      state.rows.set(key(id, version), { ...cur, status });
    },
    async insertNewVersion(args) {
      state.inserts.push(args);
      if (state.rows.has(key(args.id, args.version))) return;
      state.rows.set(
        key(args.id, args.version),
        makeRecipeRow({
          id: args.id,
          version: args.version,
          status: args.status,
          class: args.class as DocumentRecipeRow['class'],
          compose_fn_ref: args.compose_fn_ref,
          required_inputs: args.required_inputs,
          required_citations: args.required_citations,
          output_formats: args.output_formats as DocumentRecipeRow['output_formats'],
          authority_tier: args.authority_tier as DocumentRecipeRow['authority_tier'],
          approval_required: args.approval_required,
          promoted_by: args.promoted_by,
        }),
      );
    },
    async maxVersionFor(id) {
      let max = 0;
      for (const r of state.rows.values()) {
        if (r.id === id && r.version > max) max = r.version;
      }
      return max;
    },
  };
  return { repo, state };
}

describe('promoteProposal', () => {
  it('deprecates the current live version, inserts n+1 as live, marks proposal approved', async () => {
    const proposalRow = makeProposalRow({});
    const recipe = makeRecipeRow({ version: 1, status: 'live' });
    const { repo: proposalRepo, state: pState } = makeProposalRepo(proposalRow);
    const { repo: recipeRepo, state: rState } = makeRecipeRepo([recipe]);

    const result = await promoteProposal(
      { proposals: proposalRepo, recipes: recipeRepo },
      {
        proposal_id: proposalRow.id,
        reviewer_user_id: 'owner-1',
        reviewer_reason: 'looks good',
      },
    );

    expect(result.newLiveVersion).toBe(2);
    // statusUpdates: deprecate old + (re)set new to live.
    expect(rState.statusUpdates).toEqual([
      { id: recipe.id, version: 1, status: 'deprecated', promotedBy: null },
      { id: recipe.id, version: 2, status: 'live', promotedBy: 'owner-1' },
    ]);
    expect(rState.inserts.length).toBe(1);
    expect(rState.inserts[0]!.version).toBe(2);
    expect(rState.inserts[0]!.status).toBe('live');
    expect(rState.inserts[0]!.promoted_by).toBe('owner-1');

    // Proposal closed as approved + audit hash threaded.
    expect(pState.marked.length).toBe(1);
    expect(pState.marked[0]!.status).toBe('approved');
    expect(pState.marked[0]!.approval_audit_hash).toBeTruthy();
    expect(pState.marked[0]!.reviewer_reason).toBe('looks good');
  });

  it('refuses to promote a non-pending proposal', async () => {
    const proposalRow = makeProposalRow({ status: 'approved' });
    const { repo: proposalRepo } = makeProposalRepo(proposalRow);
    const { repo: recipeRepo } = makeRecipeRepo([
      makeRecipeRow({ version: 1, status: 'live' }),
    ]);
    await expect(
      promoteProposal(
        { proposals: proposalRepo, recipes: recipeRepo },
        {
          proposal_id: proposalRow.id,
          reviewer_user_id: 'u',
          reviewer_reason: null,
        },
      ),
    ).rejects.toThrow(/refused/);
  });

  it('throws when the proposal cannot be found', async () => {
    const { repo: proposalRepo } = makeProposalRepo(makeProposalRow({}));
    const { repo: recipeRepo } = makeRecipeRepo([
      makeRecipeRow({ version: 1, status: 'live' }),
    ]);
    await expect(
      promoteProposal(
        { proposals: proposalRepo, recipes: recipeRepo },
        {
          proposal_id: 'nope',
          reviewer_user_id: 'u',
          reviewer_reason: null,
        },
      ),
    ).rejects.toThrow(/not found/);
  });
});

describe('rejectProposal', () => {
  it('marks the proposal rejected and skips recipe writes', async () => {
    const proposalRow = makeProposalRow({});
    const { repo: proposalRepo, state: pState } = makeProposalRepo(proposalRow);
    const recipeRepoSpy = makeRecipeRepo([
      makeRecipeRow({ version: 1, status: 'live' }),
    ]);
    await rejectProposal(
      { proposals: proposalRepo, recipes: recipeRepoSpy.repo },
      {
        proposal_id: proposalRow.id,
        reviewer_user_id: 'owner-1',
        reviewer_reason: 'unclear citations',
      },
    );
    expect(pState.marked.length).toBe(1);
    expect(pState.marked[0]!.status).toBe('rejected');
    expect(pState.marked[0]!.reviewer_reason).toBe('unclear citations');
    expect(recipeRepoSpy.state.statusUpdates).toEqual([]);
    expect(recipeRepoSpy.state.inserts).toEqual([]);
  });

  it('refuses to reject an already-reviewed proposal', async () => {
    const proposalRow = makeProposalRow({ status: 'rejected' });
    const { repo: proposalRepo } = makeProposalRepo(proposalRow);
    const { repo: recipeRepo } = makeRecipeRepo([
      makeRecipeRow({ version: 1, status: 'live' }),
    ]);
    await expect(
      rejectProposal(
        { proposals: proposalRepo, recipes: recipeRepo },
        {
          proposal_id: proposalRow.id,
          reviewer_user_id: 'u',
          reviewer_reason: null,
        },
      ),
    ).rejects.toThrow(/refused/);
    // The `vi` import is wired so we keep the test file consistent
    // with the other suites; no spy needed here.
    const _ = vi;
    void _;
  });
});

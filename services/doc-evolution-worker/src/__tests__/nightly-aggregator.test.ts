/**
 * nightly-aggregator.test — end-to-end (with stubs) coverage of the
 * orchestrator: walks live recipes, applies decision tables, dispatches
 * proposals.
 */

import { describe, it, expect } from 'vitest';
import { runNightlyAggregation } from '../aggregator/nightly-aggregator.js';
import type {
  NightlyAggregatorConfig,
  NightlyAggregatorDeps,
} from '../aggregator/nightly-aggregator.js';
import type {
  DocFeedbackEventRow,
  DocumentRecipeRow,
  ProposalStatus,
} from '../types.js';
import type {
  ArtifactRepository,
} from '../storage/artifact-repository.js';
import type {
  FeedbackRepository,
} from '../storage/feedback-repository.js';
import type {
  ProposalRepository,
  InsertProposalArgs,
} from '../storage/proposal-repository.js';
import type {
  NewRecipeVersionArgs,
  RecipeRepository,
} from '../storage/recipe-repository.js';
import type {
  ProposalLlmPort,
} from '../decisions/proposal-generator.js';

const baseConfig: NightlyAggregatorConfig = {
  rolling_window_days: 60,
  lock_sustained_days: 90,
  regulator_flag_lookback_days: 30,
  lock_acceptance_threshold: 0.8,
  lock_revision_ceiling: 0.1,
  improve_acceptance_ceiling: 0.5,
  improve_section_revision_threshold: 0.2,
  now_iso: '2026-05-01T00:00:00Z',
};

function makeRecipeRepo(rows: DocumentRecipeRow[]): {
  repo: RecipeRepository;
  statusUpdates: Array<{ id: string; version: number; status: string }>;
} {
  const statusUpdates: Array<{ id: string; version: number; status: string }> =
    [];
  const repo: RecipeRepository = {
    async listLive() {
      return rows.filter((r) => r.status === 'live');
    },
    async listByStatus(s) {
      return rows.filter((r) => r.status === s);
    },
    async findById(id, version) {
      return rows.find((r) => r.id === id && r.version === version) ?? null;
    },
    async updateStatus(id, version, status) {
      statusUpdates.push({ id, version, status });
      const row = rows.find((r) => r.id === id && r.version === version);
      if (row !== undefined) {
        const idx = rows.indexOf(row);
        rows[idx] = { ...row, status: status as DocumentRecipeRow['status'] };
      }
    },
    async insertNewVersion(_args: NewRecipeVersionArgs) {
      /* not used in this test */
    },
    async maxVersionFor() {
      return 1;
    },
  };
  return { repo, statusUpdates };
}

function makeFeedbackRepo(
  events: DocFeedbackEventRow[],
  regulatorFlags = 0,
): FeedbackRepository {
  return {
    async listForRecipeWindow() {
      return events;
    },
    async countRegulatorFlags() {
      return regulatorFlags;
    },
    async countByKind() {
      return [];
    },
  };
}

function makeArtifactRepo(count: number): ArtifactRepository {
  return {
    async countByRecipeWindow() {
      return count;
    },
    async listPendingTier2() {
      return [];
    },
    async updateApprovalState() {
      /* noop */
    },
    async findById() {
      return null;
    },
  };
}

function makeProposalRepo(): {
  repo: ProposalRepository;
  inserts: InsertProposalArgs[];
} {
  const inserts: InsertProposalArgs[] = [];
  const repo: ProposalRepository = {
    async insertPending(args) {
      inserts.push(args);
      return {
        id: 'prop-1',
        tenant_id: args.tenant_id,
        recipe_id: args.recipe_id,
        current_version: args.current_version,
        proposed_version: args.proposed_version,
        proposed_diff: args.proposed_diff,
        signals: args.signals,
        citations: args.citations,
        status: 'pending' as ProposalStatus,
        proposed_at: '2026-05-01T00:00:00Z',
        reviewed_at: null,
        reviewed_by: null,
        reviewer_reason: null,
        approval_audit_hash: null,
      };
    },
    async listPendingForRecipe() {
      return [];
    },
    async markReviewed() {},
    async findById() {
      return null;
    },
  };
  return { repo, inserts };
}

function makeRecipe(
  overrides: Partial<DocumentRecipeRow> = {},
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
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function makeEvent(
  overrides: Partial<DocFeedbackEventRow> = {},
): DocFeedbackEventRow {
  return {
    id: overrides.id ?? 'e1',
    artifact_id: overrides.artifact_id ?? 'a1',
    tenant_id: overrides.tenant_id ?? 't1',
    feedback_kind: overrides.feedback_kind ?? 'accepted',
    section_path: overrides.section_path ?? null,
    detail: overrides.detail ?? {},
    recorded_at: overrides.recorded_at ?? '2026-04-15T10:00:00Z',
  };
}

const llmYesProposal: ProposalLlmPort = {
  async generate() {
    return JSON.stringify({
      recipe_id: 'tumemadini_monthly_return',
      current_version: 1,
      proposed_version: 2,
      summary: 'Tighten assays section per inspector feedback.',
      edits: [
        {
          kind: 'rewrite',
          section_path: 'section.assays',
          rationale: 'inspector wants ppm not %',
          proposed_text: 'Au reported in ppm.',
        },
      ],
    });
  },
};

describe('runNightlyAggregation', () => {
  it('locks a recipe when criteria + streak are met', async () => {
    const recipe = makeRecipe({ version: 1, status: 'live' });
    const { repo: recipes, statusUpdates } = makeRecipeRepo([recipe]);
    const events: DocFeedbackEventRow[] = [
      makeEvent({ id: 'e1', artifact_id: 'a1', feedback_kind: 'accepted' }),
      makeEvent({ id: 'e2', artifact_id: 'a2', feedback_kind: 'accepted' }),
    ];
    const deps: NightlyAggregatorDeps = {
      recipes,
      feedback: makeFeedbackRepo(events, 0),
      artifacts: makeArtifactRepo(2),
      proposals: makeProposalRepo().repo,
      llm: llmYesProposal,
      notificationSink: { emit() {} },
      readCandidateStreakDays: async () => 95,
      writeCandidateStreakDays: async () => {},
    };
    const summary = await runNightlyAggregation(deps, baseConfig);
    expect(summary.lock_decisions).toBe(1);
    expect(statusUpdates).toContainEqual({
      id: recipe.id,
      version: 1,
      status: 'locked',
    });
  });

  it('emits an improve proposal when acceptance is below ceiling', async () => {
    const recipe = makeRecipe({ version: 1, status: 'live' });
    const { repo: recipes } = makeRecipeRepo([recipe]);
    // Two artifacts, both first event was a revision → acceptance = 0.
    const events: DocFeedbackEventRow[] = [
      makeEvent({ id: 'e1', artifact_id: 'a1', feedback_kind: 'revised', section_path: 'section.assays' }),
      makeEvent({ id: 'e2', artifact_id: 'a2', feedback_kind: 'revised', section_path: 'section.assays' }),
    ];
    const proposal = makeProposalRepo();
    const deps: NightlyAggregatorDeps = {
      recipes,
      feedback: makeFeedbackRepo(events, 0),
      artifacts: makeArtifactRepo(2),
      proposals: proposal.repo,
      llm: llmYesProposal,
      notificationSink: { emit() {} },
    };
    const summary = await runNightlyAggregation(deps, baseConfig);
    expect(summary.improve_decisions).toBe(1);
    expect(summary.proposals_emitted).toBe(1);
    expect(proposal.inserts.length).toBe(1);
    expect(proposal.inserts[0]!.recipe_id).toBe('tumemadini_monthly_return');
  });

  it('skips locked recipes', async () => {
    const recipe = makeRecipe({ version: 1, status: 'live' });
    const lockedRecipe = makeRecipe({ id: 'r2', version: 1, status: 'locked' });
    const { repo: recipes } = makeRecipeRepo([recipe, lockedRecipe]);
    const deps: NightlyAggregatorDeps = {
      recipes,
      feedback: makeFeedbackRepo([], 0),
      artifacts: makeArtifactRepo(0),
      proposals: makeProposalRepo().repo,
      llm: llmYesProposal,
      notificationSink: { emit() {} },
    };
    const summary = await runNightlyAggregation(deps, baseConfig);
    // listLive() only returns 'live' rows, so the locked recipe never
    // reaches processRecipe; still, recipes_scanned reflects what was scanned.
    expect(summary.recipes_scanned).toBe(1);
  });

  it('drops a recipe whose proposal fails validation', async () => {
    const recipe = makeRecipe({ version: 1, status: 'live' });
    const { repo: recipes } = makeRecipeRepo([recipe]);
    const events: DocFeedbackEventRow[] = [
      makeEvent({ id: 'e1', artifact_id: 'a1', feedback_kind: 'revised', section_path: 'section.assays' }),
    ];
    const proposal = makeProposalRepo();
    // LLM returns a diff with an unknown section path → validator refuses.
    const llmBad: ProposalLlmPort = {
      async generate() {
        return JSON.stringify({
          recipe_id: 'tumemadini_monthly_return',
          current_version: 1,
          proposed_version: 2,
          summary: 'fix',
          edits: [
            {
              kind: 'rewrite',
              section_path: 'section.unknown',
              rationale: 'r',
              proposed_text: 'x',
            },
          ],
        });
      },
    };
    const deps: NightlyAggregatorDeps = {
      recipes,
      feedback: makeFeedbackRepo(events, 0),
      artifacts: makeArtifactRepo(1),
      proposals: proposal.repo,
      llm: llmBad,
      notificationSink: { emit() {} },
    };
    const summary = await runNightlyAggregation(deps, baseConfig);
    expect(summary.improve_decisions).toBe(0);
    expect(proposal.inserts.length).toBe(0);
  });

  it('tolerates an LLM that throws', async () => {
    const recipe = makeRecipe({ version: 1, status: 'live' });
    const { repo: recipes } = makeRecipeRepo([recipe]);
    const events: DocFeedbackEventRow[] = [
      makeEvent({ id: 'e1', artifact_id: 'a1', feedback_kind: 'revised', section_path: 'section.assays' }),
    ];
    const llmCrash: ProposalLlmPort = {
      async generate() {
        throw new Error('llm down');
      },
    };
    const deps: NightlyAggregatorDeps = {
      recipes,
      feedback: makeFeedbackRepo(events, 0),
      artifacts: makeArtifactRepo(1),
      proposals: makeProposalRepo().repo,
      llm: llmCrash,
      notificationSink: { emit() {} },
    };
    const summary = await runNightlyAggregation(deps, baseConfig);
    expect(summary.improve_decisions).toBe(0);
    expect(summary.errored).toBe(0);
  });

  it('returns an empty summary when listLive throws', async () => {
    const recipes: RecipeRepository = {
      async listLive() {
        throw new Error('db down');
      },
      async listByStatus() {
        return [];
      },
      async findById() {
        return null;
      },
      async updateStatus() {},
      async insertNewVersion() {},
      async maxVersionFor() {
        return 0;
      },
    };
    const deps: NightlyAggregatorDeps = {
      recipes,
      feedback: makeFeedbackRepo([], 0),
      artifacts: makeArtifactRepo(0),
      proposals: makeProposalRepo().repo,
      llm: llmYesProposal,
      notificationSink: { emit() {} },
    };
    const summary = await runNightlyAggregation(deps, baseConfig);
    expect(summary.recipes_scanned).toBe(0);
  });
});

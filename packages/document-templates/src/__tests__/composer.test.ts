/**
 * Composer dispatcher tests — recipe resolution, INPUT_GAP refusal,
 * RECIPE_NOT_FOUND refusal, registry overrides, version pinning.
 */

import { describe, expect, it } from 'vitest';
import { composeDoc } from '../composer.js';
import {
  BUILT_IN_RECIPES,
  DocumentRecipeRegistry,
  defaultRecipeRegistry,
} from '../registry.js';
import { CompositionError } from '../types.js';
import type { DocComposeContext, DocumentRecipe } from '../types.js';
import { dailyBriefingRecipe } from '../recipes/daily-briefing.js';
import {
  approveArtifact,
  initialApprovalState,
  markAutoPublished,
  rejectArtifact,
} from '../approval/workflow.js';
import { tumemadiniReturnRecipe } from '../recipes/tumemadini-return.js';

function makeCtx(recipe: DocumentRecipe): DocComposeContext {
  return {
    tenant_id: 'tenant-test',
    intent_payload: {},
    available_data: recipe.required_inputs.map((i) => ({
      key: i.key,
      value: 'present',
    })),
    research_result_id: null,
    owner_profile: {
      id: 'owner-1',
      displayName: 'Mr. Mwikila',
      preferred_language: 'en',
    },
    mastery_tier: 'veteran',
    target_audience: 'owner',
    language: 'en',
    citations: [
      {
        id: 'cit-001',
        claim: 'baseline cited claim',
        source: { kind: 'corpus_chunk', ref: 'chunk-1' },
      },
    ],
    generated_at: '2026-05-26T08:00:00.000Z',
  };
}

describe('composeDoc dispatcher', () => {
  it('resolves the latest live recipe by id', async () => {
    const ctx = makeCtx(dailyBriefingRecipe);
    const artifact = await composeDoc({ recipe_id: 'daily_briefing', ctx });
    expect(artifact.recipe_id).toBe('daily_briefing');
  });

  it('refuses with RECIPE_NOT_FOUND for unknown ids', async () => {
    const ctx = makeCtx(dailyBriefingRecipe);
    await expect(
      composeDoc({ recipe_id: 'nonexistent', ctx }),
    ).rejects.toBeInstanceOf(CompositionError);
  });

  it('refuses with RECIPE_NOT_FOUND for unknown version', async () => {
    const ctx = makeCtx(dailyBriefingRecipe);
    await expect(
      composeDoc({ recipe_id: 'daily_briefing', recipe_version: 99, ctx }),
    ).rejects.toBeInstanceOf(CompositionError);
  });

  it('refuses with INPUT_GAP when required inputs are missing', async () => {
    const ctx: DocComposeContext = {
      ...makeCtx(tumemadiniReturnRecipe),
      available_data: [], // wipe required inputs
    };
    await expect(
      composeDoc({ recipe_id: 'tumemadini_monthly_return', ctx }),
    ).rejects.toMatchObject({ code: 'INPUT_GAP' });
  });
});

describe('DocumentRecipeRegistry', () => {
  it('exposes 11 built-in recipes', () => {
    expect(defaultRecipeRegistry.list().length).toBe(11);
    expect(BUILT_IN_RECIPES.length).toBe(11);
  });

  it('returns the live recipe via getLive', () => {
    const r = defaultRecipeRegistry.getLive('daily_briefing');
    expect(r).not.toBeNull();
    expect(r?.id).toBe('daily_briefing');
  });

  it('returns null for unknown live recipes', () => {
    expect(defaultRecipeRegistry.getLive('missing')).toBeNull();
  });

  it('lists by status', () => {
    const live = defaultRecipeRegistry.listByStatus('live');
    expect(live.length).toBe(11);
    expect(defaultRecipeRegistry.listByStatus('draft')).toHaveLength(0);
  });

  it('lists by class', () => {
    const found = defaultRecipeRegistry.listByClass('daily_briefing');
    expect(found.length).toBe(1);
    expect(found[0]?.id).toBe('daily_briefing');
  });

  it('registers a new shadow recipe immutably', () => {
    const shadow: DocumentRecipe = {
      ...dailyBriefingRecipe,
      version: 2,
      status: 'shadow',
    };
    const before = new DocumentRecipeRegistry();
    const after = before.register(shadow);
    expect(after.get('daily_briefing', 2)?.status).toBe('shadow');
    // Original is untouched.
    expect(before.get('daily_briefing', 2)).toBeNull();
  });

  it('refuses to overwrite a locked recipe', () => {
    const locked: DocumentRecipe = {
      ...dailyBriefingRecipe,
      version: 5,
      status: 'locked',
    };
    const reg = new DocumentRecipeRegistry([...BUILT_IN_RECIPES, locked]);
    expect(() =>
      reg.register({ ...locked, status: 'live' }),
    ).toThrow(CompositionError);
  });
});

describe('approval workflow', () => {
  it('initialApprovalState distinguishes Tier 1 vs Tier 2', () => {
    expect(initialApprovalState(1)).toBe('auto_published');
    expect(initialApprovalState(2)).toBe('pending');
  });

  it('approveArtifact transitions pending → approved', async () => {
    const ctx = makeCtx(tumemadiniReturnRecipe);
    const artifact = await composeDoc({
      recipe_id: 'tumemadini_monthly_return',
      ctx,
    });
    expect(artifact.approval_state).toBe('pending');
    const approved = approveArtifact({ artifact, approver_id: 'owner-1' });
    expect(approved.approval_state).toBe('approved');
    expect(approved.approved_by).toBe('owner-1');
  });

  it('rejectArtifact transitions pending → rejected', async () => {
    const ctx = makeCtx(tumemadiniReturnRecipe);
    const artifact = await composeDoc({
      recipe_id: 'tumemadini_monthly_return',
      ctx,
    });
    const rejected = rejectArtifact({ artifact, rejector_id: 'owner-1' });
    expect(rejected.approval_state).toBe('rejected');
  });

  it('refuses to approve an already-approved artifact', async () => {
    const ctx = makeCtx(tumemadiniReturnRecipe);
    const artifact = await composeDoc({
      recipe_id: 'tumemadini_monthly_return',
      ctx,
    });
    const approved = approveArtifact({ artifact, approver_id: 'owner-1' });
    expect(() => approveArtifact({ artifact: approved, approver_id: 'owner-1' })).toThrow(
      CompositionError,
    );
  });

  it('refuses to auto-publish a pending Tier-2 artifact', async () => {
    const ctx = makeCtx(tumemadiniReturnRecipe);
    const artifact = await composeDoc({
      recipe_id: 'tumemadini_monthly_return',
      ctx,
    });
    expect(() => markAutoPublished(artifact)).toThrow(CompositionError);
  });
});

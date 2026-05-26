/**
 * Recipe smoke tests — every one of the 11 closed-set recipes must
 * compose successfully against a minimal mock context.
 *
 * If a recipe fails this test, the closed-set contract from spec §2
 * is broken — either add a passing `compose` impl or remove the
 * recipe from `BUILT_IN_RECIPES`.
 */

import { describe, expect, it } from 'vitest';
import type { DocComposeContext, DocumentRecipe, SpanCitation } from '../types.js';
import { BUILT_IN_RECIPES } from '../registry.js';

const CITATIONS: ReadonlyArray<SpanCitation> = [
  {
    id: 'cit-001',
    claim: 'Reference claim for smoke test.',
    source: { kind: 'corpus_chunk', ref: 'chunk-1' },
  },
];

function makeCtx(recipe: DocumentRecipe): DocComposeContext {
  const available_data = recipe.required_inputs.map((i) => ({
    key: i.key,
    value: `placeholder for ${i.key}`,
  }));
  return {
    tenant_id: 'tenant-test',
    intent_payload: { trigger: 'smoke' },
    available_data,
    research_result_id: null,
    owner_profile: {
      id: 'owner-1',
      displayName: 'Mr. Mwikila',
      preferred_language: 'en',
    },
    mastery_tier: 'veteran',
    target_audience: 'owner',
    language: 'en',
    citations: CITATIONS,
    generated_at: '2026-05-26T08:00:00.000Z',
  };
}

describe('11 recipes smoke compose', () => {
  it('exposes exactly 11 built-in recipes', () => {
    expect(BUILT_IN_RECIPES.length).toBe(11);
  });

  it('every recipe declares brand=borjie', () => {
    for (const r of BUILT_IN_RECIPES) {
      expect(r.brand).toBe('borjie');
    }
  });

  it('every recipe has a non-empty output_formats list', () => {
    for (const r of BUILT_IN_RECIPES) {
      expect(r.output_formats.length).toBeGreaterThan(0);
    }
  });

  it('every Tier-2 recipe sets approval_required=true', () => {
    for (const r of BUILT_IN_RECIPES) {
      if (r.authority_tier === 2) {
        expect(r.approval_required).toBe(true);
      }
    }
  });

  for (const recipe of BUILT_IN_RECIPES) {
    it(`compose(${recipe.id}) returns a sealed artifact`, async () => {
      const ctx = makeCtx(recipe);
      const artifact = await recipe.compose(ctx);
      expect(artifact.recipe_id).toBe(recipe.id);
      expect(artifact.recipe_version).toBe(recipe.version);
      expect(artifact.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(artifact.audit_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(artifact.format).toBeOneOf(recipe.output_formats as string[]);
      expect(artifact.storage_key).toContain(`borjie-docs-${recipe.class}`);
      // Tier 2 recipes land in pending; others auto_published.
      if (recipe.authority_tier === 2) {
        expect(artifact.approval_state).toBe('pending');
      } else {
        expect(['auto_published', 'pending']).toContain(artifact.approval_state);
      }
    });
  }
});

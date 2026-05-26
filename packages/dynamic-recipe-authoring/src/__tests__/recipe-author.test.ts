import { describe, it, expect } from 'vitest';
import { createRecipeAuthor } from '../author/recipe-author.js';
import { createInMemoryAuthoredRecipeRepository } from '../repositories/authored-recipe-repository.js';
import type { LlmAuthorPort } from '../types.js';

const validTabSpec = {
  id: 'pit-safety-kpis-by-shift',
  intent: 'PitSafetyKpisByShift',
  version: 1,
  status: 'draft' as const,
  telemetry_key: 'pit_safety_kpis_by_shift',
  brand: 'borjie' as const,
  authority_tier: 1 as const,
  form: {
    title_en: 'Pit safety KPIs by shift',
    title_sw: 'KPI za usalama wa shimo kwa zamu',
    groups: [
      {
        id: 'shift-meta',
        title_en: 'Shift metadata',
        title_sw: 'Maelezo ya zamu',
        fields: [
          {
            id: 'shift_id',
            kind: 'text',
            label_en: 'Shift id',
            label_sw: 'Kitambulisho cha zamu',
            required: true,
          },
        ],
      },
    ],
    submit_action: {
      form_id: 'pit-safety-kpis-by-shift',
      url: '/api/gateway/forms/pit-safety-kpis-by-shift',
      method: 'POST' as const,
    },
    evidence_ids: [],
  },
};

describe('recipe-author orchestrator', () => {
  it('persists a draft authored recipe after a valid LLM call', async () => {
    const llm: LlmAuthorPort = async () => ({
      spec: validTabSpec,
      modelId: 'stub-claude',
    });
    const repository = createInMemoryAuthoredRecipeRepository();
    const author = createRecipeAuthor({ llm, repository });

    const result = await author.author({
      tenantId: 't1',
      kind: 'tab',
      intentUtterance:
        'I want a tab that shows pit safety KPIs broken by shift',
      authoredBy: 'mr-mwikila',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipe.lifecycleState).toBe('draft');
      expect(result.recipe.kind).toBe('tab');
      expect(result.recipe.spec['brand']).toBe('borjie');
      expect(result.nextTransitions).toEqual(['shadow', 'deprecated']);
    }
  });

  it('returns invalid_spec when the LLM emits a malformed payload', async () => {
    const llm: LlmAuthorPort = async () => ({
      spec: { id: 'broken', brand: 'borjie' /* missing form, etc. */ },
      modelId: 'stub-claude',
    });
    const repository = createInMemoryAuthoredRecipeRepository();
    const author = createRecipeAuthor({ llm, repository });

    const result = await author.author({
      tenantId: 't1',
      kind: 'tab',
      intentUtterance: 'broken intent',
      authoredBy: 'mr-mwikila',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_spec');
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('returns invalid_request when the envelope is malformed', async () => {
    const llm: LlmAuthorPort = async () => ({
      spec: validTabSpec,
      modelId: 'stub-claude',
    });
    const repository = createInMemoryAuthoredRecipeRepository();
    const author = createRecipeAuthor({ llm, repository });

    const result = await author.author({
      tenantId: '',
      kind: 'tab',
      intentUtterance: '   ',
      authoredBy: '',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_request');
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('returns unsupported_kind for media when no custom prompt builder is injected', async () => {
    const llm: LlmAuthorPort = async () => ({
      spec: { id: 'x', version: 1, status: 'draft', brand: 'borjie' },
      modelId: 'stub-claude',
    });
    const repository = createInMemoryAuthoredRecipeRepository();
    const author = createRecipeAuthor({ llm, repository });

    const result = await author.author({
      tenantId: 't1',
      kind: 'media',
      intentUtterance: 'make me a banner',
      authoredBy: 'mr-mwikila',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('unsupported_kind');
    }
  });

  it('falls back to a slug derived from the utterance when no name is supplied', async () => {
    const llm: LlmAuthorPort = async () => ({
      // The validated spec id will be persisted as the name.
      spec: validTabSpec,
      modelId: 'stub-claude',
    });
    const repository = createInMemoryAuthoredRecipeRepository();
    const author = createRecipeAuthor({ llm, repository });

    const result = await author.author({
      tenantId: 't1',
      kind: 'tab',
      intentUtterance: 'Pit safety KPIs by shift',
      authoredBy: 'mr-mwikila',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipe.name).toBe('pit-safety-kpis-by-shift');
    }
  });
});

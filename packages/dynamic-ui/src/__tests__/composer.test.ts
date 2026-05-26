import { describe, expect, it } from 'vitest';

import {
  composeTab,
  validateFormSchema,
  actionRef,
  ComposeError,
} from '../composer.js';
import { createTabRecipeRegistry } from '../registry.js';
import { buyerKybStartRecipe } from '../recipes/buyer-kyb-start.js';
import { siteInspectionStartRecipe } from '../recipes/site-inspection-start.js';
import type {
  CorpusAccessor,
  DataJoinAccessor,
  FormSchema,
  OwnerPreferenceProfile,
  TabComposeContext,
} from '../types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function corpusAlwaysTrue(): CorpusAccessor {
  return {
    hasCitation: async () => true,
    lookup: async (id: string) => ({
      rule_en: `rule body for ${id} (en)`,
      rule_sw: `rule body for ${id} (sw)`,
    }),
  };
}

function joinsEmpty(): DataJoinAccessor {
  return {
    get: async () => null,
  };
}

function joinsWith(map: Record<string, unknown>): DataJoinAccessor {
  return {
    get: async <T>(key: string) => (map[key] ?? null) as T | null,
  };
}

const OWNER_PREFS: OwnerPreferenceProfile = {
  owner_only_keys: [],
  ops_default_keys: [],
  auto_keys: [],
};

function ctx(
  overrides: Partial<TabComposeContext> = {},
): TabComposeContext {
  return {
    tenantId: 't-1',
    operator: { userId: 'u-1', masteryLevel: 'intermediate' },
    corpus: corpusAlwaysTrue(),
    joins: joinsEmpty(),
    ownerPreferences: OWNER_PREFS,
    locale: 'en',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// composeTab — happy path with the reference recipes
// ---------------------------------------------------------------------------

describe('composeTab — buyer KYB recipe', () => {
  it('produces a 3-group FormSchema with citations', async () => {
    const registry = createTabRecipeRegistry().register(buyerKybStartRecipe);
    const { recipe, schema } = await composeTab(ctx(), {
      registry,
      recipeId: 'buyer_kyb_start',
    });
    expect(recipe.id).toBe('buyer_kyb_start');
    expect(recipe.authority_tier).toBe(2);
    expect(schema.title_en).toBe('New buyer onboarding (KYB)');
    expect(schema.title_sw).toBe('Usajili wa mnunuzi mpya (KYB)');
    expect(schema.groups).toHaveLength(3);
    const ids = schema.groups.map((g) => g.id);
    expect(ids).toEqual(['identity', 'licence', 'financial']);
    expect(schema.evidence_ids.length).toBeGreaterThanOrEqual(3);
    expect(schema.submit_action.url).toBe('/api/gateway/forms/buyer_kyb_start');
  });

  it('drops fields beyond the novice limit', async () => {
    const registry = createTabRecipeRegistry().register(buyerKybStartRecipe);
    const { schema } = await composeTab(
      ctx({
        operator: { userId: 'u-1', masteryLevel: 'novice' },
      }),
      { registry, recipeId: 'buyer_kyb_start' },
    );
    for (const group of schema.groups) {
      expect(group.fields.length).toBeLessThanOrEqual(2);
    }
  });

  it('attaches prefill values from joins', async () => {
    const registry = createTabRecipeRegistry().register(buyerKybStartRecipe);
    const { schema } = await composeTab(
      ctx({
        joins: joinsWith({
          'buyer.tin_number': '123456789',
          'buyer.legal_name': 'Jamhuri Mining Ltd',
        }),
      }),
      { registry, recipeId: 'buyer_kyb_start' },
    );
    const identity = schema.groups.find((g) => g.id === 'identity');
    expect(identity).toBeDefined();
    const tin = identity?.fields.find((f) => f.id === 'tin_number');
    expect(tin?.prefill).toBe('123456789');
  });
});

describe('composeTab — site inspection recipe', () => {
  it('produces a 2-group FormSchema (tier 1)', async () => {
    const registry = createTabRecipeRegistry().register(siteInspectionStartRecipe);
    const { recipe, schema } = await composeTab(ctx(), {
      registry,
      recipeId: 'site_inspection_start',
    });
    expect(recipe.authority_tier).toBe(1);
    expect(schema.groups).toHaveLength(2);
    expect(schema.groups[0]?.id).toBe('site_selector');
    expect(schema.groups[1]?.id).toBe('observation');
    expect(schema.evidence_ids.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// composeTab — intent dispatch + error paths
// ---------------------------------------------------------------------------

describe('composeTab — intent dispatch', () => {
  it('resolves a recipe by intentKind', async () => {
    const registry = createTabRecipeRegistry().register(buyerKybStartRecipe);
    const { recipe } = await composeTab(ctx(), {
      registry,
      intentKind: 'BuyerKYBStart',
    });
    expect(recipe.id).toBe('buyer_kyb_start');
  });

  it('throws when neither recipeId nor intentKind is set', async () => {
    const registry = createTabRecipeRegistry().register(buyerKybStartRecipe);
    await expect(composeTab(ctx(), { registry })).rejects.toBeInstanceOf(
      ComposeError,
    );
  });

  it('throws when both recipeId AND intentKind are set', async () => {
    const registry = createTabRecipeRegistry().register(buyerKybStartRecipe);
    await expect(
      composeTab(ctx(), {
        registry,
        recipeId: 'a',
        intentKind: 'b',
      }),
    ).rejects.toBeInstanceOf(ComposeError);
  });

  it('throws when no recipe is bound', async () => {
    const registry = createTabRecipeRegistry();
    await expect(
      composeTab(ctx(), { registry, recipeId: 'missing' }),
    ).rejects.toThrow(/no live Tab Recipe/);
  });
});

// ---------------------------------------------------------------------------
// validateFormSchema — failure modes
// ---------------------------------------------------------------------------

function baseSchema(): FormSchema {
  return {
    title_en: 'T',
    title_sw: 'T',
    groups: [
      {
        id: 'g1',
        title_en: 'g1',
        title_sw: 'g1',
        fields: [
          {
            id: 'f1',
            kind: 'text',
            label_en: 'L',
            label_sw: 'L',
            required: true,
            required_because: { rule: 'r', citation_id: 'C-1' },
          },
        ],
      },
    ],
    submit_action: actionRef('f1'),
    evidence_ids: [],
  };
}

describe('validateFormSchema', () => {
  it('passes a well-formed schema', () => {
    const s = validateFormSchema(baseSchema());
    expect(s.evidence_ids).toContain('C-1');
  });

  it('rejects empty title', () => {
    const s = baseSchema();
    expect(() =>
      validateFormSchema({ ...s, title_en: '' }),
    ).toThrow(ComposeError);
  });

  it('rejects an empty groups list', () => {
    const s = baseSchema();
    expect(() => validateFormSchema({ ...s, groups: [] })).toThrow(
      /at least one group/,
    );
  });

  it('rejects a group with no fields', () => {
    const s = baseSchema();
    expect(() =>
      validateFormSchema({
        ...s,
        groups: [{ ...s.groups[0]!, fields: [] }],
      }),
    ).toThrow(/zero fields/);
  });

  it('rejects required field with no required_because', () => {
    const s = baseSchema();
    expect(() =>
      validateFormSchema({
        ...s,
        groups: [
          {
            ...s.groups[0]!,
            fields: [
              {
                id: 'f1',
                kind: 'text',
                label_en: 'L',
                label_sw: 'L',
                required: true,
              },
            ],
          },
        ],
      }),
    ).toThrow(/missing required_because/);
  });

  it('rejects malformed submit_action.url', () => {
    const s = baseSchema();
    expect(() =>
      validateFormSchema({
        ...s,
        submit_action: { form_id: 'f', url: 'https://evil.example/leak', method: 'POST' },
      }),
    ).toThrow(/submit_action\.url/);
  });

  it('rejects non-POST submit method', () => {
    const s = baseSchema();
    expect(() =>
      validateFormSchema({
        ...s,
        // @ts-expect-error — runtime guard test
        submit_action: { form_id: 'f', url: '/api/gateway/forms/f', method: 'GET' },
      }),
    ).toThrow(/must be 'POST'/);
  });

  it('rejects duplicate group ids', () => {
    const s = baseSchema();
    expect(() =>
      validateFormSchema({
        ...s,
        groups: [s.groups[0]!, s.groups[0]!],
      }),
    ).toThrow(/duplicate group id/);
  });

  it('rejects duplicate field ids in one group', () => {
    const s = baseSchema();
    expect(() =>
      validateFormSchema({
        ...s,
        groups: [
          {
            ...s.groups[0]!,
            fields: [s.groups[0]!.fields[0]!, s.groups[0]!.fields[0]!],
          },
        ],
      }),
    ).toThrow(/duplicate field id/);
  });
});

// ---------------------------------------------------------------------------
// actionRef helper
// ---------------------------------------------------------------------------

describe('actionRef', () => {
  it('builds the canonical url', () => {
    const ref = actionRef('demo');
    expect(ref.url).toBe('/api/gateway/forms/demo');
    expect(ref.method).toBe('POST');
    expect(ref.form_id).toBe('demo');
  });

  it('respects a custom url base', () => {
    const ref = actionRef('demo', '/api/gateway/forms');
    expect(ref.url).toBe('/api/gateway/forms/demo');
  });
});

// ---------------------------------------------------------------------------
// Field selectors — direct unit coverage
// ---------------------------------------------------------------------------

describe('regulatoryFields selector', () => {
  it('drops requirements with no citation in the corpus', async () => {
    const { regulatoryFields } = await import('../field-selectors/regulatory.js');
    const select = regulatoryFields({
      groups: [{ id: 'g', title_en: 'G', title_sw: 'G' }],
      requirements: [
        {
          field_id: 'a',
          group_id: 'g',
          kind: 'text',
          label_en: 'A',
          label_sw: 'A',
          help_en: '',
          help_sw: '',
          citation: { rule: 'r', citation_id: 'EXISTS' },
        },
        {
          field_id: 'b',
          group_id: 'g',
          kind: 'text',
          label_en: 'B',
          label_sw: 'B',
          help_en: '',
          help_sw: '',
          citation: { rule: 'r', citation_id: 'MISSING' },
        },
      ],
    });
    const corpus: CorpusAccessor = {
      hasCitation: async (id) => id === 'EXISTS',
      lookup: async () => null,
    };
    const groups = await select({ ...ctx(), corpus });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.fields).toHaveLength(1);
    expect(groups[0]?.fields[0]?.id).toBe('a');
  });

  it('throws when constructed with empty groups or requirements', async () => {
    const { regulatoryFields } = await import('../field-selectors/regulatory.js');
    expect(() =>
      regulatoryFields({ groups: [], requirements: [] }),
    ).toThrow(/at least one group/);
    expect(() =>
      regulatoryFields({
        groups: [{ id: 'g', title_en: 'g', title_sw: 'g' }],
        requirements: [],
      }),
    ).toThrow(/at least one requirement/);
  });
});

describe('applyMasteryTier', () => {
  it('drops gated_expert groups for novice', async () => {
    const { applyMasteryTier } = await import('../field-selectors/mastery-tier.js');
    const transform = applyMasteryTier({ noviceFieldsPerGroup: 5 });
    const out = await transform(
      [
        {
          id: 'always',
          title_en: 'A',
          title_sw: 'A',
          fields: [
            {
              id: 'f',
              kind: 'text',
              label_en: 'L',
              label_sw: 'L',
              required: false,
            },
          ],
          visibility: 'always',
        },
        {
          id: 'gated',
          title_en: 'B',
          title_sw: 'B',
          fields: [
            {
              id: 'f',
              kind: 'text',
              label_en: 'L',
              label_sw: 'L',
              required: false,
            },
          ],
          visibility: 'gated_expert',
        },
      ],
      ctx({ operator: { userId: 'u', masteryLevel: 'novice' } }),
    );
    expect(out.map((g) => g.id)).toEqual(['always']);
  });

  it('shows gated_power_user groups only for power-user', async () => {
    const { applyMasteryTier } = await import('../field-selectors/mastery-tier.js');
    const transform = applyMasteryTier({ noviceFieldsPerGroup: 5 });
    const groups = [
      {
        id: 'pu',
        title_en: 'PU',
        title_sw: 'PU',
        fields: [
          {
            id: 'f',
            kind: 'text' as const,
            label_en: 'L',
            label_sw: 'L',
            required: false,
          },
        ],
        visibility: 'gated_power_user' as const,
      },
    ];
    const expert = await transform(
      groups,
      ctx({ operator: { userId: 'u', masteryLevel: 'expert' } }),
    );
    expect(expert).toHaveLength(0);
    const pu = await transform(
      groups,
      ctx({ operator: { userId: 'u', masteryLevel: 'power-user' } }),
    );
    expect(pu).toHaveLength(1);
  });

  it('respects intermediate cap when set', async () => {
    const { applyMasteryTier } = await import('../field-selectors/mastery-tier.js');
    const transform = applyMasteryTier({
      noviceFieldsPerGroup: 1,
      intermediateFieldsPerGroup: 2,
    });
    const out = await transform(
      [
        {
          id: 'g',
          title_en: 'g',
          title_sw: 'g',
          fields: [
            { id: 'a', kind: 'text', label_en: 'a', label_sw: 'a', required: false },
            { id: 'b', kind: 'text', label_en: 'b', label_sw: 'b', required: false },
            { id: 'c', kind: 'text', label_en: 'c', label_sw: 'c', required: false },
          ],
        },
      ],
      ctx({ operator: { userId: 'u', masteryLevel: 'intermediate' } }),
    );
    expect(out[0]?.fields).toHaveLength(2);
  });

  it('rejects non-positive noviceFieldsPerGroup', async () => {
    const { applyMasteryTier } = await import('../field-selectors/mastery-tier.js');
    expect(() => applyMasteryTier({ noviceFieldsPerGroup: 0 })).toThrow();
    expect(() => applyMasteryTier({ noviceFieldsPerGroup: 1.5 })).toThrow();
  });

  it('keeps required fields ahead of optional when clipping', async () => {
    const { applyMasteryTier } = await import('../field-selectors/mastery-tier.js');
    const transform = applyMasteryTier({ noviceFieldsPerGroup: 1 });
    const out = await transform(
      [
        {
          id: 'g',
          title_en: 'g',
          title_sw: 'g',
          fields: [
            {
              id: 'opt',
              kind: 'text',
              label_en: 'o',
              label_sw: 'o',
              required: false,
            },
            {
              id: 'req',
              kind: 'text',
              label_en: 'r',
              label_sw: 'r',
              required: true,
              required_because: { rule: 'r', citation_id: 'C' },
            },
          ],
        },
      ],
      ctx({ operator: { userId: 'u', masteryLevel: 'novice' } }),
    );
    expect(out[0]?.fields[0]?.id).toBe('req');
  });
});

describe('applyDataJoins', () => {
  it('leaves fields without rules untouched', async () => {
    const { applyDataJoins } = await import('../field-selectors/data-join.js');
    const transform = applyDataJoins({ rules: [] });
    const out = await transform(
      [
        {
          id: 'g',
          title_en: 'g',
          title_sw: 'g',
          fields: [
            {
              id: 'f',
              kind: 'text',
              label_en: 'L',
              label_sw: 'L',
              required: false,
            },
          ],
        },
      ],
      ctx(),
    );
    expect(out[0]?.fields[0]?.prefill).toBeUndefined();
  });

  it('skips prefill when join is null', async () => {
    const { applyDataJoins } = await import('../field-selectors/data-join.js');
    const transform = applyDataJoins({
      rules: [{ field_id: 'f', join_key: 'k' }],
    });
    const out = await transform(
      [
        {
          id: 'g',
          title_en: 'g',
          title_sw: 'g',
          fields: [
            {
              id: 'f',
              kind: 'text',
              label_en: 'L',
              label_sw: 'L',
              required: false,
            },
          ],
        },
      ],
      ctx({ joins: { get: async () => null } }),
    );
    expect(out[0]?.fields[0]?.prefill).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Evidence helper
// ---------------------------------------------------------------------------

describe('evidence helpers', () => {
  it('collects citation contracts', async () => {
    const { collectCitationContracts, hasFullCitationCoverage } = await import(
      '../evidence.js'
    );
    const schema = baseSchema();
    expect(collectCitationContracts(schema)).toHaveLength(1);
    expect(hasFullCitationCoverage(schema)).toBe(true);
  });

  it('reports missing coverage', async () => {
    const { hasFullCitationCoverage } = await import('../evidence.js');
    const schema = baseSchema();
    const bad: FormSchema = {
      ...schema,
      groups: [
        {
          ...schema.groups[0]!,
          fields: [
            {
              id: 'x',
              kind: 'text',
              label_en: 'x',
              label_sw: 'x',
              required: true,
            },
          ],
        },
      ],
    };
    expect(hasFullCitationCoverage(bad)).toBe(false);
  });

  it('resolveCitation falls back to contract rule', async () => {
    const { resolveCitation } = await import('../evidence.js');
    const silent: CorpusAccessor = {
      hasCitation: async () => false,
      lookup: async () => null,
    };
    const resolved = await resolveCitation(
      { rule: 'fallback', citation_id: 'X' },
      silent,
    );
    expect(resolved?.rule_en).toBe('fallback');
  });

  it('resolveCitation returns null when both corpus and contract are silent', async () => {
    const { resolveCitation } = await import('../evidence.js');
    const silent: CorpusAccessor = {
      hasCitation: async () => false,
      lookup: async () => null,
    };
    const resolved = await resolveCitation(
      { rule: '', citation_id: 'X' },
      silent,
    );
    expect(resolved).toBeNull();
  });

  it('resolveAllCitations returns a Map', async () => {
    const { resolveAllCitations } = await import('../evidence.js');
    const schema = baseSchema();
    const map = await resolveAllCitations(schema, corpusAlwaysTrue());
    expect(map.size).toBeGreaterThanOrEqual(1);
    expect(map.get('C-1')?.rule_en).toContain('C-1');
  });

  it('citationIdsFromField only emits for required fields', async () => {
    const { citationIdsFromField } = await import('../evidence.js');
    expect(
      citationIdsFromField({
        id: 'a',
        kind: 'text',
        label_en: 'a',
        label_sw: 'a',
        required: false,
      }),
    ).toEqual([]);
    expect(
      citationIdsFromField({
        id: 'a',
        kind: 'text',
        label_en: 'a',
        label_sw: 'a',
        required: true,
        required_because: { rule: 'r', citation_id: 'C' },
      }),
    ).toEqual(['C']);
  });
});

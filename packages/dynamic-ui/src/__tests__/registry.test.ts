import { describe, expect, it } from 'vitest';

import {
  TabRecipeRegistry,
  TabRecipeRegistryError,
  createTabRecipeRegistry,
} from '../registry.js';
import type { FormSchema, TabComposeContext, TabRecipe } from '../types.js';

function makeRecipe(
  overrides: Partial<TabRecipe> = {},
): TabRecipe {
  return {
    id: 'demo_recipe',
    intent: 'DemoIntent',
    version: 1,
    status: 'live',
    telemetry_key: 'ui.recipe.demo',
    brand: 'borjie',
    authority_tier: 1,
    compose: async (_ctx: TabComposeContext): Promise<FormSchema> => ({
      title_en: 'Demo',
      title_sw: 'Demo',
      groups: [],
      submit_action: {
        form_id: 'demo',
        url: '/api/gateway/forms/demo',
        method: 'POST',
      },
      evidence_ids: [],
    }),
    ...overrides,
  };
}

describe('TabRecipeRegistry — basic lifecycle', () => {
  it('starts empty', () => {
    const reg = createTabRecipeRegistry();
    expect(reg.lookup('anything')).toBeNull();
    expect(reg.list()).toEqual([]);
  });

  it('returns a new registry on register (immutability)', () => {
    const a = createTabRecipeRegistry();
    const b = a.register(makeRecipe());
    expect(a).not.toBe(b);
    expect(a.lookup('demo_recipe')).toBeNull();
    expect(b.lookup('demo_recipe')).not.toBeNull();
  });

  it('looks up the live version', () => {
    const reg = createTabRecipeRegistry().register(makeRecipe());
    const result = reg.lookup('demo_recipe');
    expect(result?.recipe.id).toBe('demo_recipe');
    expect(result?.liveVersion).toBe(1);
    expect(result?.shadowVersion).toBeUndefined();
  });

  it('looks up by intent', () => {
    const reg = createTabRecipeRegistry().register(makeRecipe());
    const result = reg.lookupByIntent('DemoIntent');
    expect(result?.recipe.id).toBe('demo_recipe');
  });

  it('returns null for unknown intent', () => {
    const reg = createTabRecipeRegistry();
    expect(reg.lookupByIntent('Nope')).toBeNull();
  });
});

describe('TabRecipeRegistry — versioned lookup', () => {
  it('lookupVersion returns the exact version', () => {
    const reg = createTabRecipeRegistry()
      .register(makeRecipe({ version: 1, status: 'deprecated' }))
      .register(makeRecipe({ version: 2, status: 'live' }));
    expect(reg.lookupVersion('demo_recipe', 1)?.status).toBe('deprecated');
    expect(reg.lookupVersion('demo_recipe', 2)?.status).toBe('live');
    expect(reg.lookupVersion('demo_recipe', 99)).toBeNull();
    expect(reg.lookupVersion('missing', 1)).toBeNull();
  });

  it('does not return draft or deprecated from lookup', () => {
    const reg = createTabRecipeRegistry().register(
      makeRecipe({ version: 1, status: 'draft' }),
    );
    expect(reg.lookup('demo_recipe')).toBeNull();
  });
});

describe('TabRecipeRegistry — shadow + lock semantics', () => {
  it('lookup returns live + shadow when both exist', () => {
    const reg = createTabRecipeRegistry()
      .register(makeRecipe({ version: 1, status: 'live' }))
      .register(makeRecipe({ version: 2, status: 'shadow' }));
    const result = reg.lookup('demo_recipe');
    expect(result?.liveVersion).toBe(1);
    expect(result?.shadowVersion).toBe(2);
  });

  it('lookupShadow returns the shadow version directly', () => {
    const reg = createTabRecipeRegistry()
      .register(makeRecipe({ version: 1, status: 'live' }))
      .register(makeRecipe({ version: 2, status: 'shadow' }));
    expect(reg.lookupShadow('demo_recipe')?.version).toBe(2);
    expect(reg.lookupShadow('missing')).toBeNull();
  });

  it('isLocked reflects locked state', () => {
    const reg = createTabRecipeRegistry().register(
      makeRecipe({ status: 'locked' }),
    );
    expect(reg.isLocked('demo_recipe')).toBe(true);
    expect(reg.isLocked('other')).toBe(false);
  });

  it('locked version surfaces through lookup as the live', () => {
    const reg = createTabRecipeRegistry().register(
      makeRecipe({ status: 'locked' }),
    );
    expect(reg.lookup('demo_recipe')?.recipe.status).toBe('locked');
  });
});

describe('TabRecipeRegistry — invariants', () => {
  it('rejects non-borjie brand', () => {
    const reg = createTabRecipeRegistry();
    expect(() =>
      reg.register(
        // @ts-expect-error — testing runtime guard
        makeRecipe({ brand: 'not-borjie' }),
      ),
    ).toThrow(TabRecipeRegistryError);
  });

  it('rejects non-positive version', () => {
    const reg = createTabRecipeRegistry();
    expect(() => reg.register(makeRecipe({ version: 0 }))).toThrow(
      TabRecipeRegistryError,
    );
    expect(() => reg.register(makeRecipe({ version: 1.5 }))).toThrow(
      TabRecipeRegistryError,
    );
  });

  it('rejects two live versions of the same id', () => {
    const reg = createTabRecipeRegistry().register(
      makeRecipe({ version: 1, status: 'live' }),
    );
    expect(() =>
      reg.register(makeRecipe({ version: 2, status: 'live' })),
    ).toThrow(/only one allowed/);
  });

  it('rejects two shadow versions of the same id', () => {
    const reg = createTabRecipeRegistry().register(
      makeRecipe({ version: 1, status: 'shadow' }),
    );
    expect(() =>
      reg.register(makeRecipe({ version: 2, status: 'shadow' })),
    ).toThrow(/only one allowed/);
  });

  it('list returns all registered recipes', () => {
    const reg = createTabRecipeRegistry()
      .register(makeRecipe({ id: 'a', intent: 'A' }))
      .register(makeRecipe({ id: 'b', intent: 'B' }));
    const all = reg.list();
    expect(all).toHaveLength(2);
    expect(all.map((e) => e.id).sort()).toEqual(['a', 'b']);
  });

  it('register replaces a version with the same number', () => {
    const reg = createTabRecipeRegistry()
      .register(makeRecipe({ status: 'draft' }))
      .register(makeRecipe({ status: 'live' }));
    expect(reg.lookup('demo_recipe')?.recipe.status).toBe('live');
  });
});

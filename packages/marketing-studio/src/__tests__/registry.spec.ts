/**
 * Registry tests — versioned lookup + locked-state refusal.
 */

import { describe, it, expect } from 'vitest';
import {
  BUILT_IN_RECIPES,
  CampaignRecipeRegistry,
} from '../registry.js';
import type { CampaignRecipe } from '../types.js';
import { MarketingError } from '../types.js';

describe('CampaignRecipeRegistry', () => {
  it('seeds built-in recipes', () => {
    const reg = new CampaignRecipeRegistry();
    expect(reg.list()).toHaveLength(BUILT_IN_RECIPES.length);
    expect(reg.list().length).toBe(3);
  });

  it('returns null for unknown ids', () => {
    const reg = new CampaignRecipeRegistry();
    expect(reg.get('nope', 1)).toBeNull();
  });

  it('returns the highest-version live recipe via getLive', () => {
    const reg = new CampaignRecipeRegistry();
    const live = reg.getLive('investor_announcement');
    expect(live).not.toBeNull();
    expect(live?.version).toBe(1);
  });

  it('refuses to overwrite a locked recipe', () => {
    const locked: CampaignRecipe = {
      ...BUILT_IN_RECIPES[0]!,
      status: 'locked',
    };
    const reg = new CampaignRecipeRegistry([locked]);
    const replacement: CampaignRecipe = {
      ...locked,
      status: 'live',
    };
    expect(() => reg.register(replacement)).toThrow(MarketingError);
  });

  it('lists by status', () => {
    const reg = new CampaignRecipeRegistry();
    const live = reg.listByStatus('live');
    expect(live.length).toBeGreaterThanOrEqual(3);
  });

  it('register returns a new registry instance (immutability)', () => {
    const orig = new CampaignRecipeRegistry([]);
    const r = BUILT_IN_RECIPES[0];
    if (r === undefined) {
      throw new Error('no built-in recipe to register');
    }
    const next = orig.register(r);
    expect(orig.list()).toHaveLength(0);
    expect(next.list()).toHaveLength(1);
  });
});

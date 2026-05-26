/**
 * Registry tests — built-in recipe count, live lookup, lock policy,
 * filter-by-status / filter-by-class.
 */

import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_RECIPES,
  MediaRecipeRegistry,
  defaultMediaRecipeRegistry,
} from '../registry.js';
import { briefingThumbnailRecipe } from '../recipes/briefing-thumbnail.js';
import type { MediaRecipe } from '../types.js';
import { MediaCompositionError } from '../types.js';

describe('MediaRecipeRegistry', () => {
  it('exposes 3 seed recipes', () => {
    expect(BUILT_IN_RECIPES.length).toBe(3);
    expect(defaultMediaRecipeRegistry.list().length).toBe(3);
  });

  it('returns the live recipe via getLive', () => {
    const r = defaultMediaRecipeRegistry.getLive('briefing_thumbnail');
    expect(r).not.toBeNull();
    expect(r?.id).toBe('briefing_thumbnail');
  });

  it('returns null for unknown ids', () => {
    expect(defaultMediaRecipeRegistry.getLive('missing')).toBeNull();
  });

  it('lists by status', () => {
    const live = defaultMediaRecipeRegistry.listByStatus('live');
    expect(live.length).toBe(3);
    expect(defaultMediaRecipeRegistry.listByStatus('draft').length).toBe(0);
  });

  it('lists by class', () => {
    const found = defaultMediaRecipeRegistry.listByClass('briefing_thumbnail');
    expect(found.length).toBe(1);
    expect(found[0]?.id).toBe('briefing_thumbnail');
  });

  it('registers a new shadow recipe immutably', () => {
    const shadow: MediaRecipe = {
      ...briefingThumbnailRecipe,
      version: 2,
      status: 'shadow',
    };
    const before = new MediaRecipeRegistry();
    const after = before.register(shadow);
    expect(after.get('briefing_thumbnail', 2)?.status).toBe('shadow');
    expect(before.get('briefing_thumbnail', 2)).toBeNull();
  });

  it('refuses to overwrite a locked recipe in place', () => {
    const locked: MediaRecipe = {
      ...briefingThumbnailRecipe,
      version: 5,
      status: 'locked',
    };
    const reg = new MediaRecipeRegistry([...BUILT_IN_RECIPES, locked]);
    expect(() =>
      reg.register({ ...locked, status: 'live' }),
    ).toThrow(MediaCompositionError);
  });

  it('seed recipes carry the closed-set classes', () => {
    const classes = BUILT_IN_RECIPES.map((r) => r.class);
    expect(classes).toEqual([
      'briefing_thumbnail',
      'marketplace_listing_hero',
      'social_post_still',
    ]);
  });

  it('seed recipes declare brand=borjie', () => {
    for (const r of BUILT_IN_RECIPES) {
      expect(r.brand).toBe('borjie');
    }
  });

  it('seed recipes declare expected authority tiers', () => {
    const briefing = BUILT_IN_RECIPES.find(
      (r) => r.id === 'briefing_thumbnail',
    );
    expect(briefing?.authority_tier).toBe(0);
    const listing = BUILT_IN_RECIPES.find(
      (r) => r.id === 'marketplace_listing_hero',
    );
    expect(listing?.authority_tier).toBe(1);
  });
});

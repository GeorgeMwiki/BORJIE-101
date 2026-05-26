/**
 * Cost-tracker tests — reserve / commit / release semantics + per-class
 * budget envelope lookup.
 */

import { describe, expect, it } from 'vitest';
import {
  MEDIA_CLASS_BUDGET_CENTS,
  MEDIA_CLASS_LATENCY_MS,
  budgetForClass,
  createClassBudgetTracker,
  createCostTracker,
  latencyMsForClass,
} from '../budgets/cost-tracker.js';

describe('createCostTracker', () => {
  it('returns true when reservation is within budget', async () => {
    const tracker = createCostTracker({ budget_usd_cents: 100 });
    expect(await tracker.tryReserve(50)).toBe(true);
    expect(await tracker.tryReserve(40)).toBe(true);
    expect(await tracker.tryReserve(20)).toBe(false); // would exceed
  });

  it('commits the measured spend + releases reservations', async () => {
    const tracker = createCostTracker({ budget_usd_cents: 100 });
    await tracker.tryReserve(50);
    await tracker.commit(30);
    expect(await tracker.spent()).toBe(30);
    // remaining capacity: 100 - 30 = 70 — a 60c reservation should fit
    expect(await tracker.tryReserve(60)).toBe(true);
  });

  it('release returns reserved capacity', async () => {
    const tracker = createCostTracker({ budget_usd_cents: 100 });
    await tracker.tryReserve(80);
    await tracker.release(80);
    expect(await tracker.tryReserve(80)).toBe(true);
  });

  it('honours initial_spent_cents', async () => {
    const tracker = createCostTracker({
      budget_usd_cents: 100,
      initial_spent_cents: 50,
    });
    expect(await tracker.spent()).toBe(50);
    expect(await tracker.tryReserve(40)).toBe(true);
    expect(await tracker.tryReserve(20)).toBe(false);
  });

  it('exposes budget()', () => {
    const tracker = createCostTracker({ budget_usd_cents: 150 });
    expect(tracker.budget()).toBe(150);
  });
});

describe('budgetForClass', () => {
  it('returns the spec budgets exactly', () => {
    expect(budgetForClass('briefing_thumbnail')).toBe(10);
    expect(budgetForClass('marketplace_listing_hero')).toBe(15);
    expect(budgetForClass('social_post_still')).toBe(10);
    expect(budgetForClass('social_post_short_video')).toBe(50);
    expect(budgetForClass('tutorial_lipsync_video')).toBe(300);
    expect(budgetForClass('investor_brand_video')).toBe(500);
    expect(budgetForClass('avatar_talking_head')).toBe(800);
  });

  it('exposes the budget map', () => {
    expect(MEDIA_CLASS_BUDGET_CENTS.briefing_thumbnail).toBe(10);
  });
});

describe('latencyMsForClass', () => {
  it('returns spec latency envelopes', () => {
    expect(latencyMsForClass('briefing_thumbnail')).toBe(15_000);
    expect(latencyMsForClass('investor_brand_video')).toBe(900_000);
    expect(MEDIA_CLASS_LATENCY_MS.avatar_talking_head).toBe(1_200_000);
  });
});

describe('createClassBudgetTracker', () => {
  it('pre-sizes the tracker to the class budget', () => {
    const t = createClassBudgetTracker('marketplace_listing_hero');
    expect(t.budget()).toBe(15);
  });
});

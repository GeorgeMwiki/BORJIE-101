/**
 * Transition tests — each transition produces correct narrative,
 * capability deltas, and tone (celebratory vs supportive).
 */

import { describe, it, expect } from 'vitest';
import { getTransition, isAdjacent } from '../transitions/index.js';
import { STAGE_ORDER } from '../stages/index.js';
import type { OrgStage } from '../types.js';

describe('getTransition — basic cases', () => {
  it('returns null when prev === curr', () => {
    expect(getTransition('seedling', 'seedling')).toBeNull();
  });

  it('classifies forward moves as grow', () => {
    const t = getTransition('seedling', 'sprout');
    expect(t?.kind).toBe('grow');
  });

  it('classifies backward moves as shrink', () => {
    const t = getTransition('sapling', 'seedling');
    expect(t?.kind).toBe('shrink');
  });

  it('grow narrative is actionable for sapling stage', () => {
    const t = getTransition('sprout', 'sapling');
    expect(t).not.toBeNull();
    expect(t!.introductionMessage).toContain('50 units');
    expect(t!.recommendedNextSteps.length).toBeGreaterThan(0);
    expect(t!.recommendedNextSteps.join(' ')).toContain('suppliers');
  });

  it('shrink narrative is supportive (not alarming)', () => {
    const t = getTransition('sapling', 'seedling');
    expect(t).not.toBeNull();
    expect(t!.introductionMessage).not.toMatch(/danger|risk|fail|alert/i);
    expect(t!.recommendedNextSteps.length).toBeGreaterThan(0);
  });

  it('grow surfaces capabilities to unlock', () => {
    const t = getTransition('sprout', 'sapling');
    expect(t).not.toBeNull();
    expect(t!.capabilitiesToUnlock).toContain('procurement-coordination');
    expect(t!.capabilitiesToUnlock).toContain('inventory-management');
    expect(t!.capabilitiesToUnlock).toContain('vendor-management');
    expect(t!.capabilitiesToReview).toHaveLength(0);
  });

  it('shrink surfaces capabilities to review (NOT auto-hide)', () => {
    const t = getTransition('tree', 'sapling');
    expect(t).not.toBeNull();
    expect(t!.capabilitiesToReview).toContain('fleet-management');
    expect(t!.capabilitiesToReview).toContain('advanced-reporting');
    expect(t!.capabilitiesToUnlock).toHaveLength(0);
  });
});

describe('getTransition — every adjacent grow transition has narrative', () => {
  for (let i = 0; i < STAGE_ORDER.length - 1; i++) {
    const from = STAGE_ORDER[i]!;
    const to = STAGE_ORDER[i + 1]!;
    it(`${from} → ${to} produces grow narrative`, () => {
      const t = getTransition(from, to);
      expect(t).not.toBeNull();
      expect(t!.kind).toBe('grow');
      expect(t!.introductionMessage.length).toBeGreaterThan(20);
      expect(t!.recommendedNextSteps.length).toBeGreaterThan(0);
    });
  }
});

describe('getTransition — every adjacent shrink transition has narrative', () => {
  for (let i = STAGE_ORDER.length - 1; i > 0; i--) {
    const from = STAGE_ORDER[i]!;
    const to = STAGE_ORDER[i - 1]!;
    it(`${from} → ${to} produces shrink narrative`, () => {
      const t = getTransition(from, to);
      expect(t).not.toBeNull();
      expect(t!.kind).toBe('shrink');
      expect(t!.introductionMessage.length).toBeGreaterThan(20);
      expect(t!.recommendedNextSteps.length).toBeGreaterThan(0);
    });
  }
});

describe('getTransition — leapfrog moves still classified', () => {
  it('seedling → tree is a grow with multiple capabilities to unlock', () => {
    const t = getTransition('seedling', 'tree');
    expect(t?.kind).toBe('grow');
    expect(t!.capabilitiesToUnlock.length).toBeGreaterThan(3);
  });

  it('ecosystem → seedling is a shrink with many capabilities to review', () => {
    const t = getTransition('ecosystem', 'seedling');
    expect(t?.kind).toBe('shrink');
    expect(t!.capabilitiesToReview.length).toBeGreaterThan(5);
  });
});

describe('isAdjacent', () => {
  it('returns true for neighbors', () => {
    expect(isAdjacent('seedling', 'sprout')).toBe(true);
    expect(isAdjacent('tree', 'forest')).toBe(true);
    expect(isAdjacent('forest', 'tree')).toBe(true);
  });
  it('returns false for non-neighbors', () => {
    expect(isAdjacent('seedling', 'tree')).toBe(false);
    expect(isAdjacent('pre-launch', 'ecosystem')).toBe(false);
  });
  it('returns false for same stage', () => {
    expect(isAdjacent('seedling', 'seedling' as OrgStage)).toBe(false);
  });
});

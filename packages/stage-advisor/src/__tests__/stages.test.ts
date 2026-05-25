/**
 * Stage taxonomy tests — every stage has a complete card and the
 * helper functions return sensible answers.
 */

import { describe, it, expect } from 'vitest';
import {
  STAGE_CARDS,
  STAGE_ORDER,
  stagesUnlocking,
  firstStageUnlocking,
} from '../stages/index.js';
import { ORG_STAGES, CAPABILITY_IDS } from '../types.js';

describe('STAGE_CARDS — every stage is fully populated', () => {
  for (const stage of ORG_STAGES) {
    it(`stage ${stage} has a complete card`, () => {
      const card = STAGE_CARDS[stage];
      expect(card.name).toBe(stage);
      expect(card.displayName.length).toBeGreaterThan(0);
      expect(card.range.min).toBeGreaterThanOrEqual(0);
      expect(card.focusAreas.length).toBeGreaterThan(0);
      expect(card.capabilitiesUnlocked.length).toBeGreaterThan(0);
      expect(card.recommendedTabs.length).toBeGreaterThanOrEqual(0);
      expect(card.recommendedAdvisors.length).toBeGreaterThanOrEqual(0);
      expect(card.stageOnboardingPlaybook.stage).toBe(stage);
      // Every playbook has ≥3 objectives per spec.
      expect(
        card.stageOnboardingPlaybook.objectives.length,
      ).toBeGreaterThanOrEqual(3);
    });
  }
});

describe('STAGE_ORDER — lifecycle ladder is sequential', () => {
  it('contains exactly the 7 stages in order', () => {
    expect(STAGE_ORDER).toEqual([
      'pre-launch',
      'seedling',
      'sprout',
      'sapling',
      'tree',
      'forest',
      'ecosystem',
    ]);
  });

  it('ranges are monotonically non-decreasing on min', () => {
    let lastMin = -1;
    for (const stage of STAGE_ORDER) {
      const card = STAGE_CARDS[stage];
      expect(card.range.min).toBeGreaterThanOrEqual(lastMin);
      lastMin = card.range.min;
    }
  });

  it('unlocked set grows monotonically along the ladder', () => {
    let last = new Set<string>();
    for (const stage of STAGE_ORDER) {
      const cur = new Set(STAGE_CARDS[stage].capabilitiesUnlocked);
      // Every previously-unlocked capability stays unlocked.
      for (const cap of last) {
        expect(cur.has(cap)).toBe(true);
      }
      last = cur;
    }
  });
});

describe('stagesUnlocking + firstStageUnlocking', () => {
  it('lease-lifecycle first unlocks at seedling', () => {
    expect(firstStageUnlocking('lease-lifecycle')).toBe('seedling');
    const stages = stagesUnlocking('lease-lifecycle');
    expect(stages).toContain('seedling');
    expect(stages).toContain('ecosystem');
    expect(stages).not.toContain('pre-launch');
  });

  it('procurement-coordination first unlocks at sapling', () => {
    expect(firstStageUnlocking('procurement-coordination')).toBe('sapling');
  });

  it('fleet-management first unlocks at tree', () => {
    expect(firstStageUnlocking('fleet-management')).toBe('tree');
  });

  it('treasury first unlocks at forest', () => {
    expect(firstStageUnlocking('treasury')).toBe('forest');
  });

  it('multi-jurisdiction first unlocks at ecosystem', () => {
    expect(firstStageUnlocking('multi-jurisdiction')).toBe('ecosystem');
  });

  it('every capability is unlocked at some stage', () => {
    for (const cap of CAPABILITY_IDS) {
      expect(firstStageUnlocking(cap)).not.toBeNull();
    }
  });
});

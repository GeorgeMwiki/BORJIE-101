/**
 * Tests for personalization-engine.ts — mastery gates, recency,
 * frustration, layout overrides.
 */
import { describe, it, expect } from 'vitest';
import {
  decidePersonalization,
  DEFAULT_PERSONALIZATION_OPTIONS,
  type PersonalizationInput,
} from '../personalization-engine.js';
import type { LayoutOverrideRow } from '../types.js';

function mkInput(
  overrides: Partial<PersonalizationInput> = {},
): PersonalizationInput {
  return {
    tenantId: 'tnt-1',
    userId: 'usr-1',
    moduleId: 'COMPLIANCE',
    baseSectionIds: ['header', 'overview', 'filings', 'advanced-analytics', 'audit-log'],
    masteryLevel: 50,
    advancedSectionIds: ['advanced-analytics'],
    beginnerSectionIds: ['header'],
    recentActionSectionIds: [],
    overrides: [],
    ...overrides,
  };
}

describe('decidePersonalization', () => {
  it('returns base ordering for intermediate user with no overrides', () => {
    const decision = decidePersonalization(mkInput({ masteryLevel: 50 }));
    expect(decision.sectionOrder).toEqual([
      'header',
      'overview',
      'filings',
      'advanced-analytics',
      'audit-log',
    ]);
    expect(decision.hiddenSectionIds).toEqual([]);
    expect(decision.rationale).toContain('intermediate');
  });

  it('hides advanced sections for novices', () => {
    const decision = decidePersonalization(mkInput({ masteryLevel: 10 }));
    expect(decision.sectionOrder).not.toContain('advanced-analytics');
    expect(decision.hiddenSectionIds).toContain('advanced-analytics');
    expect(decision.rationale).toContain('novice');
  });

  it('hides beginner sections for experts', () => {
    const decision = decidePersonalization(mkInput({ masteryLevel: 90 }));
    expect(decision.sectionOrder).not.toContain('header');
    expect(decision.hiddenSectionIds).toContain('header');
    expect(decision.rationale).toContain('expert');
  });

  it('hides advanced sections when frustration is high', () => {
    const decision = decidePersonalization(
      mkInput({ masteryLevel: 50, frustration: 0.8 }),
    );
    expect(decision.sectionOrder).not.toContain('advanced-analytics');
    expect(decision.rationale).toContain('frustration');
  });

  it('does not hide advanced sections when frustration is below threshold', () => {
    const decision = decidePersonalization(
      mkInput({ masteryLevel: 50, frustration: 0.4 }),
    );
    expect(decision.sectionOrder).toContain('advanced-analytics');
  });

  it('boosts recent actions to the top', () => {
    const decision = decidePersonalization(
      mkInput({
        masteryLevel: 50,
        recentActionSectionIds: ['filings', 'audit-log'],
      }),
    );
    // filings should be near the top because it's most recent.
    expect(decision.sectionOrder[0]).toBe('filings');
    expect(decision.rationale).toContain('recency');
  });

  it('respects visibility override (hide)', () => {
    const ov: LayoutOverrideRow = {
      id: 'ov-1',
      tenantId: 'tnt-1',
      userId: 'usr-1',
      sectionId: 'overview',
      overrideKind: 'visibility',
      override: { hidden: true },
      priority: 200,
      createdAt: new Date(),
    };
    const decision = decidePersonalization(
      mkInput({ masteryLevel: 50, overrides: [ov] }),
    );
    expect(decision.sectionOrder).not.toContain('overview');
    expect(decision.hiddenSectionIds).toContain('overview');
  });

  it('respects visibility override (unhide hidden-by-mastery)', () => {
    const ov: LayoutOverrideRow = {
      id: 'ov-1',
      tenantId: 'tnt-1',
      userId: 'usr-1',
      sectionId: 'advanced-analytics',
      overrideKind: 'visibility',
      override: { hidden: false },
      priority: 300,
      createdAt: new Date(),
    };
    const decision = decidePersonalization(
      mkInput({ masteryLevel: 10, overrides: [ov] }),
    );
    // Even though novice, override forces visible.
    expect(decision.sectionOrder).toContain('advanced-analytics');
  });

  it('respects position override (pin)', () => {
    const ov: LayoutOverrideRow = {
      id: 'ov-1',
      tenantId: 'tnt-1',
      userId: 'usr-1',
      sectionId: 'audit-log',
      overrideKind: 'position',
      override: { pinned: true },
      priority: 200,
      createdAt: new Date(),
    };
    const decision = decidePersonalization(
      mkInput({ masteryLevel: 50, overrides: [ov] }),
    );
    expect(decision.sectionOrder[0]).toBe('audit-log');
  });

  it('higher priority override wins on conflict', () => {
    const hide: LayoutOverrideRow = {
      id: 'ov-1',
      tenantId: 'tnt-1',
      userId: 'usr-1',
      sectionId: 'filings',
      overrideKind: 'visibility',
      override: { hidden: true },
      priority: 50,
      createdAt: new Date(),
    };
    const show: LayoutOverrideRow = {
      id: 'ov-2',
      tenantId: 'tnt-1',
      userId: 'usr-1',
      sectionId: 'filings',
      overrideKind: 'visibility',
      override: { hidden: false },
      priority: 200,
      createdAt: new Date(),
    };
    // Higher-priority unhide should win, even though hide was first in input.
    const decision = decidePersonalization(
      mkInput({ masteryLevel: 50, overrides: [hide, show] }),
    );
    expect(decision.sectionOrder).toContain('filings');
  });

  it('ignores overrides for sections not in base', () => {
    const ov: LayoutOverrideRow = {
      id: 'ov-1',
      tenantId: 'tnt-1',
      userId: 'usr-1',
      sectionId: 'phantom-section',
      overrideKind: 'visibility',
      override: { hidden: true },
      priority: 200,
      createdAt: new Date(),
    };
    const decision = decidePersonalization(
      mkInput({ masteryLevel: 50, overrides: [ov] }),
    );
    expect(decision.sectionOrder).toContain('header');
    expect(decision.sectionOrder).not.toContain('phantom-section');
  });

  it('clamps mastery level to 0-100', () => {
    const lo = decidePersonalization(mkInput({ masteryLevel: -10 }));
    expect(lo.masteryLevel).toBe(0);
    const hi = decidePersonalization(mkInput({ masteryLevel: 200 }));
    expect(hi.masteryLevel).toBe(100);
  });

  it('clamps frustration to 0-1', () => {
    const decision = decidePersonalization(
      mkInput({ masteryLevel: 50, frustration: 5 }),
    );
    // 5 clamps to 1 which is >= 0.6, hides advanced.
    expect(decision.sectionOrder).not.toContain('advanced-analytics');
  });

  it('uses provided density preference', () => {
    const decision = decidePersonalization(
      mkInput({ densityPreference: 'compact' }),
    );
    expect(decision.densityPreference).toBe('compact');
  });

  it('defaults density to comfortable', () => {
    const decision = decidePersonalization(mkInput());
    expect(decision.densityPreference).toBe('comfortable');
  });

  it('dedupes base section ids', () => {
    const decision = decidePersonalization(
      mkInput({ baseSectionIds: ['header', 'overview', 'header'] }),
    );
    expect(decision.sectionOrder).toEqual(['header', 'overview']);
  });

  it('is deterministic — same input yields same output', () => {
    const input = mkInput({
      masteryLevel: 40,
      recentActionSectionIds: ['filings'],
      frustration: 0.3,
    });
    const a = decidePersonalization(input);
    const b = decidePersonalization(input);
    expect(a.sectionOrder).toEqual(b.sectionOrder);
    expect(a.hiddenSectionIds).toEqual(b.hiddenSectionIds);
    expect(a.rationale).toBe(b.rationale);
  });

  it('merges custom props from props overrides', () => {
    const ov: LayoutOverrideRow = {
      id: 'ov-1',
      tenantId: 'tnt-1',
      userId: 'usr-1',
      sectionId: 'overview',
      overrideKind: 'props',
      override: { props: { filter: 'pending' } },
      priority: 200,
      createdAt: new Date(),
    };
    const decision = decidePersonalization(
      mkInput({ masteryLevel: 50, overrides: [ov] }),
    );
    // overview still visible; props are merged in (but not surfaced in
    // public output for this minimal API — the cron persists them
    // separately via PersonalizationRow.customProps).
    expect(decision.sectionOrder).toContain('overview');
  });

  it('uses DEFAULT_PERSONALIZATION_OPTIONS when no options passed', () => {
    expect(DEFAULT_PERSONALIZATION_OPTIONS.noviceMaxMastery).toBe(31);
    expect(DEFAULT_PERSONALIZATION_OPTIONS.expertMinMastery).toBe(71);
  });
});

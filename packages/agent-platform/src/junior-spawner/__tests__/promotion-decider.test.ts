/**
 * promotion-decider.test.ts — Wave 18V-DYNAMIC.
 *
 * Asserts the promotion thresholds + state transitions:
 *   - seed never promotes
 *   - draft is no-change (handled elsewhere)
 *   - shadow → live when uses ≥ 10 AND satisfaction ≥ 0.7
 *   - live → locked when uses ≥ 50 AND satisfaction ≥ 0.85 AND sustained ≥ 30d
 *   - locked + deprecated are no-change
 *   - thresholds are honoured per-tenant override
 *   - shouldPromoteDraftToShadow flips on first use
 */

import { describe, expect, it } from 'vitest';
import {
  decidePromotion,
  shouldPromoteDraftToShadow,
} from '../lifecycle/promotion-decider.js';
import type { PersistedJuniorRecord } from '../types.js';

function makeJunior(
  overrides: Partial<PersistedJuniorRecord>,
): PersistedJuniorRecord {
  return {
    id: 'j',
    display_name: 'Mr. Mwikila',
    subtitle: "Borjie's AI Generic Specialist",
    specialisation: 'Generic',
    provenance: 'spawned',
    lifecycle_status: 'shadow',
    scope: {
      data_tables: [],
      tab_recipes_owned: [],
      doc_recipes_owned: [],
      media_recipes_owned: [],
      research_topics: [],
      authority_tier_max: 1,
      requires_md_for_tier_2: true,
    },
    modes: [],
    escalation_policy: {
      auto_escalate_above_authority_tier: 1,
      auto_escalate_on_cross_domain: true,
      auto_escalate_on_low_confidence: true,
      hand_off_transcript_to_mr_mwikila: true,
    },
    target_audiences: ['manager'],
    authority_tier_max: 1,
    tenant_id: 'tenant-a',
    usage_count: 0,
    avg_satisfaction: null,
    last_used_at: null,
    spawned_by_user_id: null,
    spawned_from_turn_id: null,
    promoted_at: null,
    locked_at: null,
    deprecated_at: null,
    ...overrides,
  };
}

describe('decidePromotion', () => {
  it('never promotes seed juniors', () => {
    const r = decidePromotion(
      makeJunior({ provenance: 'seed', lifecycle_status: 'live' }),
      { usage_count: 1_000, avg_satisfaction: 1, sustained_days_at_target: 365 },
    );
    expect(r.kind).toBe('no_change');
  });

  it('returns no_change for drafts (first-use path handles them)', () => {
    const r = decidePromotion(
      makeJunior({ lifecycle_status: 'draft' }),
      { usage_count: 5, avg_satisfaction: 0.9, sustained_days_at_target: 0 },
    );
    expect(r.kind).toBe('no_change');
  });

  it('promotes shadow → live when thresholds are met', () => {
    const r = decidePromotion(
      makeJunior({ lifecycle_status: 'shadow' }),
      { usage_count: 10, avg_satisfaction: 0.7, sustained_days_at_target: 0 },
    );
    expect(r.kind).toBe('promote');
    if (r.kind === 'promote') expect(r.to).toBe('live');
  });

  it('does not promote shadow when uses below threshold', () => {
    const r = decidePromotion(
      makeJunior({ lifecycle_status: 'shadow' }),
      { usage_count: 9, avg_satisfaction: 0.9, sustained_days_at_target: 0 },
    );
    expect(r.kind).toBe('no_change');
  });

  it('does not promote shadow when satisfaction below threshold', () => {
    const r = decidePromotion(
      makeJunior({ lifecycle_status: 'shadow' }),
      { usage_count: 100, avg_satisfaction: 0.5, sustained_days_at_target: 0 },
    );
    expect(r.kind).toBe('no_change');
  });

  it('promotes live → locked when sustained thresholds met', () => {
    const r = decidePromotion(
      makeJunior({ lifecycle_status: 'live' }),
      { usage_count: 50, avg_satisfaction: 0.85, sustained_days_at_target: 30 },
    );
    expect(r.kind).toBe('promote');
    if (r.kind === 'promote') expect(r.to).toBe('locked');
  });

  it('does not promote live when sustain window too short', () => {
    const r = decidePromotion(
      makeJunior({ lifecycle_status: 'live' }),
      { usage_count: 100, avg_satisfaction: 0.9, sustained_days_at_target: 29 },
    );
    expect(r.kind).toBe('no_change');
  });

  it('returns no_change for locked', () => {
    const r = decidePromotion(
      makeJunior({ lifecycle_status: 'locked' }),
      { usage_count: 9999, avg_satisfaction: 1, sustained_days_at_target: 1000 },
    );
    expect(r.kind).toBe('no_change');
  });

  it('returns no_change for deprecated', () => {
    const r = decidePromotion(
      makeJunior({ lifecycle_status: 'deprecated' }),
      { usage_count: 9999, avg_satisfaction: 1, sustained_days_at_target: 1000 },
    );
    expect(r.kind).toBe('no_change');
  });

  it('honours per-tenant overrides', () => {
    const r = decidePromotion(
      makeJunior({ lifecycle_status: 'shadow' }),
      { usage_count: 10, avg_satisfaction: 0.7, sustained_days_at_target: 0 },
      {
        shadow_to_live_min_uses: 100,
        shadow_to_live_min_satisfaction: 0.9,
        live_to_locked_min_uses: 200,
        live_to_locked_min_satisfaction: 0.95,
        live_to_locked_sustain_days: 60,
        deprecation_satisfaction_floor: 0.3,
        deprecation_idle_days: 60,
      },
    );
    expect(r.kind).toBe('no_change');
  });
});

describe('shouldPromoteDraftToShadow', () => {
  it('returns true for spawned draft with at least one use', () => {
    expect(
      shouldPromoteDraftToShadow(
        makeJunior({ provenance: 'spawned', lifecycle_status: 'draft', usage_count: 1 }),
      ),
    ).toBe(true);
  });

  it('returns false for draft with zero uses', () => {
    expect(
      shouldPromoteDraftToShadow(
        makeJunior({ provenance: 'spawned', lifecycle_status: 'draft', usage_count: 0 }),
      ),
    ).toBe(false);
  });

  it('returns false for seed juniors', () => {
    expect(
      shouldPromoteDraftToShadow(
        makeJunior({ provenance: 'seed', lifecycle_status: 'draft', usage_count: 5 }),
      ),
    ).toBe(false);
  });
});

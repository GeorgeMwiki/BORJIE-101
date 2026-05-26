/**
 * seed-matcher.test.ts — Wave 18V-DYNAMIC.
 *
 * Asserts:
 *   - scoreJuniorAgainstIntent returns 0 when audience mismatches
 *   - scoreJuniorAgainstIntent returns 0 when no intent keywords
 *   - keyword overlap produces deterministic scores
 *   - topMatchInPool tie-breaks by avg_satisfaction → usage_count → last_used_at
 *   - findSeedMatch filters to provenance=seed only
 */

import { describe, expect, it } from 'vitest';
import {
  findSeedMatch,
  scoreJuniorAgainstIntent,
  topMatchInPool,
} from '../selection/seed-matcher.js';
import type { PersistedJuniorRecord } from '../types.js';

function makeJunior(
  overrides: Partial<PersistedJuniorRecord> = {},
): PersistedJuniorRecord {
  return {
    id: 'mining-shift-planner',
    display_name: 'Mr. Mwikila',
    subtitle: "Borjie's AI Shift Planning Specialist",
    specialisation: 'Shift Planning',
    provenance: 'seed',
    lifecycle_status: 'live',
    scope: {
      data_tables: [],
      tab_recipes_owned: [],
      doc_recipes_owned: [],
      media_recipes_owned: [],
      research_topics: ['shift', 'planning', 'roster'],
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
    target_audiences: ['manager', 'employee'],
    authority_tier_max: 1,
    tenant_id: null,
    usage_count: 5,
    avg_satisfaction: 0.7,
    last_used_at: new Date('2026-01-01'),
    spawned_by_user_id: null,
    spawned_from_turn_id: null,
    promoted_at: null,
    locked_at: null,
    deprecated_at: null,
    ...overrides,
  };
}

describe('scoreJuniorAgainstIntent', () => {
  it('returns 0 when audience is not in target_audiences', () => {
    const junior = makeJunior({ target_audiences: ['employee'] });
    expect(scoreJuniorAgainstIntent(junior, ['shift'], 'owner')).toBe(0);
  });

  it('returns 0 when intent keywords is empty', () => {
    const junior = makeJunior();
    expect(scoreJuniorAgainstIntent(junior, [], 'manager')).toBe(0);
  });

  it('returns fraction of matched keywords', () => {
    const junior = makeJunior();
    // 2 of 4 keywords found in topics/spec/subtitle
    const score = scoreJuniorAgainstIntent(
      junior,
      ['shift', 'planning', 'absent_word_one', 'absent_word_two'],
      'manager',
    );
    expect(score).toBeCloseTo(0.5, 5);
  });

  it('is case-insensitive', () => {
    const junior = makeJunior();
    const score = scoreJuniorAgainstIntent(junior, ['SHIFT'], 'manager');
    expect(score).toBeGreaterThan(0);
  });
});

describe('topMatchInPool', () => {
  it('returns null junior for empty pool', () => {
    const r = topMatchInPool([], ['shift'], 'manager');
    expect(r.junior).toBeNull();
    expect(r.score).toBe(0);
  });

  it('returns null when no juniors score above zero', () => {
    const j = makeJunior({
      scope: { ...makeJunior().scope, research_topics: ['fishing'] },
      specialisation: 'Fishing',
      subtitle: "Borjie's AI Fishing Specialist",
    });
    const r = topMatchInPool([j], ['drone-imagery-unique-token'], 'manager');
    expect(r.junior).toBeNull();
  });

  it('tie-breaks by avg_satisfaction', () => {
    const lo = makeJunior({ id: 'lo', avg_satisfaction: 0.5 });
    const hi = makeJunior({ id: 'hi', avg_satisfaction: 0.9 });
    const r = topMatchInPool([lo, hi], ['shift'], 'manager');
    expect(r.junior?.id).toBe('hi');
  });

  it('tie-breaks by usage_count when satisfaction is equal', () => {
    const lo = makeJunior({ id: 'lo', avg_satisfaction: 0.7, usage_count: 1 });
    const hi = makeJunior({ id: 'hi', avg_satisfaction: 0.7, usage_count: 99 });
    const r = topMatchInPool([lo, hi], ['shift'], 'manager');
    expect(r.junior?.id).toBe('hi');
  });
});

describe('findSeedMatch', () => {
  it('ignores non-seed juniors', () => {
    const seed = makeJunior({ id: 'seed' });
    const spawned = makeJunior({ id: 'spawned', provenance: 'spawned', tenant_id: 't' });
    const r = findSeedMatch([seed, spawned], ['shift'], 'manager');
    expect(r.junior?.id).toBe('seed');
  });
});

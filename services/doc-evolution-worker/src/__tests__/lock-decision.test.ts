/**
 * lock-decision.test — covers the spec §7 decision table:
 *
 *   acceptance >80%, revision <10%, regulator_flag_count_30d=0
 *     AND streak >= sustained_days → LOCK
 *   AND streak < sustained_days   → lock_candidate
 *   Any condition fails           → hold
 */

import { describe, it, expect } from 'vitest';
import { decideLock } from '../decisions/lock-decision.js';
import type { RecipeFitnessStats } from '../types.js';

const stats = (overrides: Partial<RecipeFitnessStats>): RecipeFitnessStats => ({
  recipe_id: overrides.recipe_id ?? 'r1',
  recipe_version: overrides.recipe_version ?? 1,
  tenant_id: overrides.tenant_id ?? 't1',
  window_start_iso: '2026-03-01T00:00:00Z',
  window_end_iso: '2026-05-01T00:00:00Z',
  composition_count: overrides.composition_count ?? 0,
  first_submit_acceptance_rate: overrides.first_submit_acceptance_rate ?? 0,
  revision_rate: overrides.revision_rate ?? 0,
  regulator_flag_count: overrides.regulator_flag_count ?? 0,
  owner_rewrite_count: overrides.owner_rewrite_count ?? 0,
  avg_time_to_approve_seconds: overrides.avg_time_to_approve_seconds ?? null,
  section_revision_rates: overrides.section_revision_rates ?? [],
});

describe('decideLock', () => {
  it('holds when zero compositions in window', () => {
    const out = decideLock({
      stats: stats({ composition_count: 0 }),
      regulator_flag_count_30d: 0,
      candidate_streak_days: 100,
    });
    expect(out.kind).toBe('hold');
    expect(out.reasons).toContain('no_compositions_in_window');
  });

  it('holds when acceptance below threshold', () => {
    const out = decideLock({
      stats: stats({
        composition_count: 50,
        first_submit_acceptance_rate: 0.79,
        revision_rate: 0.05,
      }),
      regulator_flag_count_30d: 0,
      candidate_streak_days: 100,
    });
    expect(out.kind).toBe('hold');
    expect(out.reasons.some((r) => r.startsWith('acceptance_below_'))).toBe(true);
  });

  it('holds when revision above ceiling', () => {
    const out = decideLock({
      stats: stats({
        composition_count: 50,
        first_submit_acceptance_rate: 0.9,
        revision_rate: 0.11,
      }),
      regulator_flag_count_30d: 0,
      candidate_streak_days: 100,
    });
    expect(out.kind).toBe('hold');
    expect(out.reasons.some((r) => r.startsWith('revision_above_'))).toBe(true);
  });

  it('holds when regulator flags > 0 in lookback', () => {
    const out = decideLock({
      stats: stats({
        composition_count: 50,
        first_submit_acceptance_rate: 0.9,
        revision_rate: 0.05,
      }),
      regulator_flag_count_30d: 1,
      candidate_streak_days: 100,
    });
    expect(out.kind).toBe('hold');
    expect(out.reasons.some((r) => r.startsWith('regulator_flags_present'))).toBe(true);
  });

  it('returns lock_candidate when conditions met but streak < sustained', () => {
    const out = decideLock({
      stats: stats({
        composition_count: 50,
        first_submit_acceptance_rate: 0.9,
        revision_rate: 0.05,
      }),
      regulator_flag_count_30d: 0,
      candidate_streak_days: 30,
    });
    expect(out.kind).toBe('lock_candidate');
    expect(out.reasons.some((r) => r.includes('streak_30_of_90'))).toBe(true);
  });

  it('returns lock when conditions met AND streak >= sustained', () => {
    const out = decideLock({
      stats: stats({
        composition_count: 50,
        first_submit_acceptance_rate: 0.95,
        revision_rate: 0.02,
      }),
      regulator_flag_count_30d: 0,
      candidate_streak_days: 90,
    });
    expect(out.kind).toBe('lock');
    expect(out.reasons.some((r) => r.startsWith('sustained_for_'))).toBe(true);
  });

  it('respects custom thresholds when provided', () => {
    const out = decideLock({
      stats: stats({
        composition_count: 50,
        first_submit_acceptance_rate: 0.71,
        revision_rate: 0.05,
      }),
      regulator_flag_count_30d: 0,
      candidate_streak_days: 5,
      thresholds: {
        acceptance_threshold: 0.7,
        revision_ceiling: 0.1,
        sustained_days: 3,
      },
    });
    expect(out.kind).toBe('lock');
  });

  it('exactly equal to threshold is treated as not-met (strict >)', () => {
    // Acceptance equal to threshold is not strictly greater → no candidacy.
    const out = decideLock({
      stats: stats({
        composition_count: 50,
        first_submit_acceptance_rate: 0.8,
        revision_rate: 0.05,
      }),
      regulator_flag_count_30d: 0,
      candidate_streak_days: 100,
    });
    expect(out.kind).toBe('hold');
  });
});

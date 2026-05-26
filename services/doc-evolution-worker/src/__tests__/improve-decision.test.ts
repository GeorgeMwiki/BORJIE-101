/**
 * improve-decision.test — spec §7 OR-joined triggers:
 *   acceptance <50% OR any section revision >20% OR any regulator flag
 */

import { describe, it, expect } from 'vitest';
import {
  decideImprove,
  targetedSectionsForImprove,
} from '../decisions/improve-decision.js';
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

describe('decideImprove', () => {
  it('holds when zero compositions', () => {
    const out = decideImprove({
      stats: stats({ composition_count: 0 }),
      regulator_flag_count_30d: 0,
    });
    expect(out.kind).toBe('hold');
  });

  it('fires improve when acceptance is below 50%', () => {
    const out = decideImprove({
      stats: stats({
        composition_count: 10,
        first_submit_acceptance_rate: 0.49,
        revision_rate: 0.05,
      }),
      regulator_flag_count_30d: 0,
    });
    expect(out.kind).toBe('improve');
    expect(out.reasons.some((r) => r.startsWith('acceptance_below_'))).toBe(true);
  });

  it('fires improve when any section revision rate exceeds 20%', () => {
    const out = decideImprove({
      stats: stats({
        composition_count: 10,
        first_submit_acceptance_rate: 0.9,
        section_revision_rates: [
          { section_path: 'section.executive_summary', revision_rate: 0.25, revision_count: 3 },
        ],
      }),
      regulator_flag_count_30d: 0,
    });
    expect(out.kind).toBe('improve');
    expect(out.reasons.some((r) => r.includes('section_revision_above_'))).toBe(true);
  });

  it('fires improve when any regulator flag is present', () => {
    const out = decideImprove({
      stats: stats({
        composition_count: 10,
        first_submit_acceptance_rate: 0.9,
        revision_rate: 0.05,
      }),
      regulator_flag_count_30d: 1,
    });
    expect(out.kind).toBe('improve');
    expect(out.reasons.some((r) => r.startsWith('regulator_flag_present'))).toBe(true);
  });

  it('holds when all thresholds satisfied', () => {
    const out = decideImprove({
      stats: stats({
        composition_count: 10,
        first_submit_acceptance_rate: 0.9,
        revision_rate: 0.02,
        section_revision_rates: [
          { section_path: 'section.a', revision_rate: 0.15, revision_count: 2 },
        ],
      }),
      regulator_flag_count_30d: 0,
    });
    expect(out.kind).toBe('hold');
  });

  it('respects custom thresholds', () => {
    const out = decideImprove({
      stats: stats({
        composition_count: 10,
        first_submit_acceptance_rate: 0.65,
        revision_rate: 0.05,
      }),
      regulator_flag_count_30d: 0,
      thresholds: {
        acceptance_ceiling: 0.7,
        section_revision_threshold: 0.5,
      },
    });
    expect(out.kind).toBe('improve');
  });
});

describe('targetedSectionsForImprove', () => {
  it('returns section paths above threshold', () => {
    const targets = targetedSectionsForImprove(
      stats({
        composition_count: 10,
        section_revision_rates: [
          { section_path: 'a', revision_rate: 0.25, revision_count: 3 },
          { section_path: 'b', revision_rate: 0.15, revision_count: 1 },
          { section_path: 'c', revision_rate: 0.5, revision_count: 5 },
        ],
      }),
    );
    expect(new Set(targets)).toEqual(new Set(['a', 'c']));
  });

  it('respects a custom threshold', () => {
    const targets = targetedSectionsForImprove(
      stats({
        composition_count: 10,
        section_revision_rates: [
          { section_path: 'a', revision_rate: 0.31, revision_count: 3 },
          { section_path: 'b', revision_rate: 0.15, revision_count: 1 },
        ],
      }),
      0.3,
    );
    expect(targets).toEqual(['a']);
  });
});

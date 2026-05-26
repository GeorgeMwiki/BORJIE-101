/**
 * fitness-scorer.test — covers the weighted composite scoring rule.
 *
 *   score = 0.5 * acceptance + 0.3 * (1-revision) + 0.2 * (1-flag_norm)
 *
 * Edges:
 *   - zero compositions → score 0 (no signal)
 *   - perfect doc (1, 0, 0) → score 1
 *   - worst-case (0, 1, max_flags) → score 0
 *   - flag count > composition_count is normalised to 1 (full penalty)
 */

import { describe, it, expect } from 'vitest';
import { scoreFitness, W_ACCEPTANCE, W_REVISION, W_REGULATOR } from '../aggregator/fitness-scorer.js';
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

describe('scoreFitness', () => {
  it('returns zero when composition_count = 0', () => {
    const result = scoreFitness(stats({ composition_count: 0 }));
    expect(result.score).toBe(0);
    expect(result.components.acceptance_component).toBe(0);
    expect(result.components.revision_component).toBe(0);
    expect(result.components.regulator_component).toBe(0);
  });

  it('weights match constants', () => {
    expect(W_ACCEPTANCE + W_REVISION + W_REGULATOR).toBeCloseTo(1, 5);
  });

  it('gives 1.0 for a perfect doc (acceptance=1, revision=0, flags=0)', () => {
    const result = scoreFitness(
      stats({
        composition_count: 10,
        first_submit_acceptance_rate: 1,
        revision_rate: 0,
        regulator_flag_count: 0,
      }),
    );
    expect(result.score).toBeCloseTo(1, 5);
  });

  it('gives 0 for a worst-case doc (acceptance=0, revision=1, flags >= count)', () => {
    const result = scoreFitness(
      stats({
        composition_count: 10,
        first_submit_acceptance_rate: 0,
        revision_rate: 1,
        regulator_flag_count: 10,
      }),
    );
    expect(result.score).toBeCloseTo(0, 5);
  });

  it('applies the documented weighting on mixed signal', () => {
    // acceptance 0.8, revision 0.1, no flags, count 10.
    const result = scoreFitness(
      stats({
        composition_count: 10,
        first_submit_acceptance_rate: 0.8,
        revision_rate: 0.1,
        regulator_flag_count: 0,
      }),
    );
    // 0.5*0.8 + 0.3*0.9 + 0.2*1 = 0.4 + 0.27 + 0.2 = 0.87
    expect(result.score).toBeCloseTo(0.87, 5);
  });

  it('normalises regulator flag count by composition_count and caps at 1', () => {
    // acceptance 1, revision 0, flags 20 over 10 compositions => normalised to 1 → regulator_component = 0.
    const result = scoreFitness(
      stats({
        composition_count: 10,
        first_submit_acceptance_rate: 1,
        revision_rate: 0,
        regulator_flag_count: 20,
      }),
    );
    // 0.5*1 + 0.3*1 + 0.2*0 = 0.8
    expect(result.score).toBeCloseTo(0.8, 5);
  });

  it('clamps negative or NaN inputs to zero', () => {
    const result = scoreFitness(
      stats({
        composition_count: 5,
        first_submit_acceptance_rate: Number.NaN,
        revision_rate: -0.5,
        regulator_flag_count: 0,
      }),
    );
    // acceptance clamped to 0; revision clamped to 0 -> (1-0)=1; flags=0 -> 1.
    // score = 0.5*0 + 0.3*1 + 0.2*1 = 0.5
    expect(result.score).toBeCloseTo(0.5, 5);
  });
});

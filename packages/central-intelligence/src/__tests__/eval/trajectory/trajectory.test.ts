/**
 * Trajectory eval tests — Phase D / D12.1.
 */

import { describe, it, expect } from 'vitest';
import {
  TRAJECTORY_SCENARIOS,
  type TrajectoryScenario,
} from './scenarios.js';
import {
  editDistance,
  runTrajectoryScenario,
  runTrajectorySuite,
} from './trajectory-runner.js';

describe('central-intelligence — trajectory eval', () => {
  it('corpus is non-empty and ids are unique + stable', () => {
    expect(TRAJECTORY_SCENARIOS.length).toBeGreaterThanOrEqual(20);
    const ids = new Set<string>();
    for (const s of TRAJECTORY_SCENARIOS) {
      expect(s.id).toMatch(/^trj\./);
      expect(ids.has(s.id), `duplicate id ${s.id}`).toBe(false);
      ids.add(s.id);
      expect(s.expectOptimalPath.length).toBeGreaterThan(0);
      expect(s.proposedPath.length).toBeGreaterThan(0);
      expect(s.tolerance).toBeGreaterThanOrEqual(0);
    }
  });

  it('coverage spans the full property-ops category set', () => {
    const categories = new Set(TRAJECTORY_SCENARIOS.map((s) => s.category));
    expect(categories.has('maintenance')).toBe(true);
    expect(categories.has('lease')).toBe(true);
    expect(categories.has('collections')).toBe(true);
    expect(categories.has('compliance')).toBe(true);
    expect(categories.has('inspection')).toBe(true);
    expect(categories.has('finance')).toBe(true);
    expect(categories.has('sovereign')).toBe(true);
  });

  describe('editDistance — primitive', () => {
    it('returns 0 for identical sequences', () => {
      expect(editDistance(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(0);
    });

    it('returns full length for empty other side', () => {
      expect(editDistance([], ['a', 'b'])).toBe(2);
      expect(editDistance(['a', 'b'], [])).toBe(2);
    });

    it('counts a single insertion', () => {
      expect(editDistance(['a', 'b', 'c'], ['a', 'x', 'b', 'c'])).toBe(1);
    });

    it('counts a single deletion', () => {
      expect(editDistance(['a', 'b', 'c', 'd'], ['a', 'b', 'c'])).toBe(1);
    });

    it('counts a single substitution', () => {
      expect(editDistance(['a', 'b', 'c'], ['a', 'x', 'c'])).toBe(1);
    });
  });

  it('every scenario passes its tolerance bound', () => {
    const outcome = runTrajectorySuite(TRAJECTORY_SCENARIOS);
    const failing = outcome.results.filter((r) => !r.pass);
    if (failing.length > 0) {
      const lines = failing.map(
        (r) => `  • [${r.scenarioId}] ${r.failures.join('; ')}`,
      );
      throw new Error(
        `${failing.length}/${outcome.results.length} trajectory scenario(s) failed:\n${lines.join('\n')}`,
      );
    }
    expect(outcome.summary.passed).toBe(TRAJECTORY_SCENARIOS.length);
    expect(outcome.summary.failed).toBe(0);
  });

  it('runTrajectoryScenario flags a deviation that exceeds tolerance', () => {
    const synthetic: TrajectoryScenario = {
      id: 'trj.synthetic.exceeds',
      description: 'synthetic',
      category: 'maintenance',
      goal: 'goal',
      expectOptimalPath: ['a', 'b'],
      proposedPath: ['a', 'b', 'c', 'd', 'e', 'f'],
      tolerance: 1,
    };
    const result = runTrajectoryScenario(synthetic);
    expect(result.pass).toBe(false);
    expect(result.deviation).toBe(4);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it('summary aggregates per-category pass rate', () => {
    const outcome = runTrajectorySuite(TRAJECTORY_SCENARIOS);
    for (const cat of Object.keys(outcome.summary.perCategoryPassRate)) {
      const rate = outcome.summary.perCategoryPassRate[
        cat as keyof typeof outcome.summary.perCategoryPassRate
      ];
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    }
  });
});

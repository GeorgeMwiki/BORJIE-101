/**
 * Long-horizon eval tests — Phase D / D12.3.
 */

import { describe, it, expect } from 'vitest';
import { LONG_HORIZON_SCENARIOS } from './scenarios.js';
import {
  runLongHorizonScenario,
  runLongHorizonSuite,
} from './long-horizon-runner.js';

describe('central-intelligence — long-horizon eval', () => {
  it('corpus is non-empty (≥10) and ids unique', () => {
    expect(LONG_HORIZON_SCENARIOS.length).toBeGreaterThanOrEqual(10);
    const ids = new Set<string>();
    for (const s of LONG_HORIZON_SCENARIOS) {
      expect(s.id).toMatch(/^lh\./);
      expect(ids.has(s.id), `duplicate id ${s.id}`).toBe(false);
      ids.add(s.id);
    }
  });

  it('every scenario has 10-15 turns inclusive', () => {
    for (const s of LONG_HORIZON_SCENARIOS) {
      expect(
        s.turns.length,
        `${s.id} has ${s.turns.length} turns; expected 10-15`,
      ).toBeGreaterThanOrEqual(10);
      expect(s.turns.length).toBeLessThanOrEqual(15);
    }
  });

  it('every turn declares a mustCarryContext substring', () => {
    for (const s of LONG_HORIZON_SCENARIOS) {
      for (const t of s.turns) {
        expect(t.mustCarryContext.length).toBeGreaterThan(0);
      }
    }
  });

  it('every scenario passes its per-turn context contract', () => {
    const outcome = runLongHorizonSuite(LONG_HORIZON_SCENARIOS);
    const failing = outcome.results.filter((r) => !r.pass);
    if (failing.length > 0) {
      const lines = failing.map(
        (r) => `  • [${r.scenarioId}] ${r.failures.join('; ')}`,
      );
      throw new Error(
        `${failing.length}/${outcome.results.length} long-horizon scenario(s) failed:\n${lines.join('\n')}`,
      );
    }
    expect(outcome.summary.passed).toBe(LONG_HORIZON_SCENARIOS.length);
    expect(outcome.summary.meanContextRetention).toBe(1);
  });

  it('runLongHorizonScenario flags turn-ordering breakage', () => {
    const broken = {
      id: 'lh.synthetic.broken-order',
      category: 'inspection-cycle' as const,
      description: 'synthetic',
      goal: 'g',
      turns: [
        { turn: 2, description: 'first', mustCarryContext: 'first' },
        { turn: 1, description: 'second', mustCarryContext: 'second' },
      ],
    };
    // First make it length 10 so it passes the length check; then verify
    // ordering flags. Build a min-10-turn variant with a swap at idx 5.
    const minBroken = {
      ...broken,
      turns: Array.from({ length: 10 }, (_, i) => ({
        turn: i === 4 ? 99 : i + 1,
        description: `step ${i}`,
        mustCarryContext: `step`,
      })),
    };
    const result = runLongHorizonScenario(minBroken);
    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes('ordering broken'))).toBe(true);
  });
});

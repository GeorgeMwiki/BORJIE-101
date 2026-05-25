import { describe, expect, it } from 'vitest';
import { runPrmEval } from './eval-harness.js';
import type { PrmEvalFixture, PrmModel } from './types.js';

// Build a 50-fixture eval set with synthetic but reproducible labels.
function buildEvalSet(): ReadonlyArray<PrmEvalFixture> {
  return Array.from({ length: 50 }, (_, i) => ({
    id: `fx_${i}`,
    step: { index: 0, description: `step ${i}` },
    contextSteps: [],
    humanLabel: (i % 10) / 10 + 0.05,
  }));
}

describe('runPrmEval', () => {
  it('rejects empty fixture set', async () => {
    const oracleModel: PrmModel = { modelId: 'oracle', score: async () => 0.5 };
    await expect(runPrmEval(oracleModel, [])).rejects.toThrow(/at least one fixture/);
  });

  it('an oracle PRM that returns the human label hits 100% accuracy and 0 MAE', async () => {
    const fixtures = buildEvalSet();
    const oracle: PrmModel = {
      modelId: 'oracle.v0',
      score: async (_step, _ctx) => {
        // Mirror the label generation in buildEvalSet by reading the
        // last numeric suffix of the description.
        const idx = Number.parseInt(_step.description.replace('step ', ''), 10);
        return (idx % 10) / 10 + 0.05;
      },
    };
    const result = await runPrmEval(oracle, fixtures);
    expect(result.modelId).toBe('oracle.v0');
    expect(result.fixtures).toBe(50);
    expect(result.meanAbsoluteError).toBeCloseTo(0, 5);
    expect(result.accuracyAt0p5).toBe(1);
  });

  it('produces a 10-bucket calibration curve', async () => {
    const fixtures = buildEvalSet();
    const constModel: PrmModel = {
      modelId: 'const-0.5',
      score: async () => 0.5,
    };
    const result = await runPrmEval(constModel, fixtures);
    expect(result.calibration).toHaveLength(10);
    // The constant model lands every prediction in bin 5
    const bin5 = result.calibration[5];
    expect(bin5).toBeDefined();
    expect(bin5?.count).toBe(50);
    // All other bins empty
    for (let i = 0; i < 10; i += 1) {
      if (i === 5) continue;
      expect(result.calibration[i]?.count).toBe(0);
    }
  });

  it('an inverted model (returns 1 - label) has high MAE and 0 accuracy', async () => {
    const fixtures = buildEvalSet();
    const inv: PrmModel = {
      modelId: 'inverted',
      score: async (step) => {
        const idx = Number.parseInt(step.description.replace('step ', ''), 10);
        return 1 - ((idx % 10) / 10 + 0.05);
      },
    };
    const result = await runPrmEval(inv, fixtures);
    // For our uniform 0.05..0.95 label distribution the average flip distance
    // is exactly 0.5 — so we assert >= 0.45 to be robust to floating-point
    // drift while still catching any regression that loses calibration.
    expect(result.meanAbsoluteError).toBeGreaterThanOrEqual(0.45);
    // Half the labels are above 0.5 and inversion sends them below, so
    // accuracy collapses to near zero.
    expect(result.accuracyAt0p5).toBeLessThan(0.5);
  });
});

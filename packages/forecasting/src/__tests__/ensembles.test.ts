/**
 * Ensemble combiners — fixture-driven tests.
 *
 * We use the deterministic mock network to build adapters that
 * predict known constants, so the combiner output is exactly
 * predictable.
 */

import { describe, it, expect } from 'vitest';
import {
  createEnsemble,
  createChronosAdapter,
  createTimesFMAdapter,
  createTimeGPTAdapter,
  type ForecastingPort,
  type TimeSeries,
  type Horizon,
  type FoundationModelNetwork,
} from '../index.js';

const ANCHOR = Date.parse('2026-01-01T00:00:00Z');
const HORIZON_2: Horizon = { steps: 2 };

function makeSeries(values: ReadonlyArray<number>): TimeSeries {
  return {
    id: 'ens-fixture',
    frequency: 'daily',
    points: values.map((y, i) => ({
      t: new Date(ANCHOR + i * 86_400_000).toISOString(),
      y,
    })),
  };
}

function constantNetwork(point: number, modelVersion: string): FoundationModelNetwork {
  return async ({ horizon }) => ({
    points: new Array(horizon.steps).fill(point),
    lower:  new Array(horizon.steps).fill(point - 1),
    upper:  new Array(horizon.steps).fill(point + 1),
    modelVersion,
  });
}

function constantAdapter(point: number, label: string): ForecastingPort {
  return createChronosAdapter({
    endpoint: 'https://x',
    network: constantNetwork(point, label),
  });
}

describe('ensembles / mean combiner', () => {
  it('returns the arithmetic mean of constant predictors', async () => {
    const ens = await createEnsemble({
      models: [constantAdapter(10, 'a'), constantAdapter(20, 'b'), constantAdapter(30, 'c')],
      opts: { combiner: 'mean' },
    });
    const out = await ens.predict({
      series: makeSeries([1, 2, 3]),
      horizon: HORIZON_2,
    });
    expect(out.points[0]!.point).toBeCloseTo(20, 5);
    expect(out.modelKind).toBe('ensemble');
  });
});

describe('ensembles / median combiner', () => {
  it('returns the median of constant predictors', async () => {
    const ens = await createEnsemble({
      models: [constantAdapter(5, 'a'), constantAdapter(100, 'b'), constantAdapter(10, 'c')],
      opts: { combiner: 'median' },
    });
    const out = await ens.predict({
      series: makeSeries([1, 2, 3]),
      horizon: HORIZON_2,
    });
    expect(out.points[0]!.point).toBeCloseTo(10, 5);
  });
});

describe('ensembles / weighted combiner', () => {
  it('returns the weighted average', async () => {
    const ens = await createEnsemble({
      models: [constantAdapter(0, 'a'), constantAdapter(100, 'b')],
      opts: { combiner: 'weighted', weights: [1, 3] },
    });
    const out = await ens.predict({
      series: makeSeries([1, 2, 3]),
      horizon: HORIZON_2,
    });
    // Weighted mean: (0*1 + 100*3) / 4 = 75
    expect(out.points[0]!.point).toBeCloseTo(75, 5);
  });

  it('rejects weights length mismatch', async () => {
    await expect(
      createEnsemble({
        models: [constantAdapter(1, 'a'), constantAdapter(2, 'b')],
        opts: { combiner: 'weighted', weights: [1] },
      }),
    ).rejects.toThrow();
  });

  it('rejects weights summing to 0', async () => {
    await expect(
      createEnsemble({
        models: [constantAdapter(1, 'a'), constantAdapter(2, 'b')],
        opts: { combiner: 'weighted', weights: [0, 0] },
      }),
    ).rejects.toThrow();
  });
});

describe('ensembles / stacking combiner', () => {
  it('learns higher weight for the better-performing model on holdout', async () => {
    // Model A predicts the truth exactly; Model B is off by +50.
    const truthful   = constantAdapter(10, 'truthful');
    const persistent = constantAdapter(60, 'biased');
    const holdoutSeries = makeSeries([1, 2, 3, 4, 5]);
    const holdoutActuals = [10, 10];
    const ens = await createEnsemble({
      models: [truthful, persistent],
      opts: {
        combiner: 'stacking',
        stackingHoldout: [
          { series: holdoutSeries, actuals: holdoutActuals, horizon: HORIZON_2 },
        ],
      },
    });
    const out = await ens.predict({
      series: makeSeries([1, 2, 3]),
      horizon: HORIZON_2,
    });
    // Combined prediction should be closer to 10 than to 60.
    expect(Math.abs(out.points[0]!.point - 10)).toBeLessThan(
      Math.abs(out.points[0]!.point - 60),
    );
  });

  it('rejects stacking without a holdout', async () => {
    await expect(
      createEnsemble({
        models: [constantAdapter(1, 'a')],
        opts: { combiner: 'stacking' },
      }),
    ).rejects.toThrow(/stackingHoldout/);
  });

  it('widens intervals by inter-model spread', async () => {
    const ens = await createEnsemble({
      models: [constantAdapter(0, 'a'), constantAdapter(100, 'b')],
      opts: { combiner: 'mean' },
    });
    const out = await ens.predict({
      series: makeSeries([1, 2, 3]),
      horizon: HORIZON_2,
    });
    // Inter-model spread is large (std of [0,100] ≈ 70.7), so the
    // widened interval should be much wider than the base [-1,1].
    expect(out.points[0]!.upper - out.points[0]!.lower).toBeGreaterThan(50);
  });
});

describe('ensembles / mixed adapters', () => {
  it('combines Chronos + TimesFM + TimeGPT seamlessly', async () => {
    const chrono = createChronosAdapter({
      endpoint: 'https://x',
      network: constantNetwork(10, 'chronos'),
    });
    const timesFM = createTimesFMAdapter({
      projectId: 'p',
      apiKey: 'k',
      network: constantNetwork(20, 'timesfm'),
    });
    const timeGPT = createTimeGPTAdapter({
      apiKey: 'k',
      network: constantNetwork(30, 'timegpt'),
    });
    const ens = await createEnsemble({
      models: [chrono, timesFM, timeGPT],
      opts: { combiner: 'mean' },
    });
    const out = await ens.predict({
      series: makeSeries([1, 2, 3]),
      horizon: HORIZON_2,
    });
    expect(out.points[0]!.point).toBeCloseTo(20, 5);
  });

  it('rejects an empty model list', async () => {
    await expect(
      createEnsemble({ models: [], opts: { combiner: 'mean' } }),
    ).rejects.toThrow();
  });
});

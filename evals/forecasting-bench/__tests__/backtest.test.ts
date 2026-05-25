import { describe, expect, it } from 'vitest';
import { planFolds, runBacktest, type BacktestConfig, type SeriesInput } from '../backtest.ts';
import {
  createLastValueBaseline,
  createSeasonalNaiveBaseline,
  defaultBaselines,
} from '../baselines.ts';

describe('planFolds', () => {
  it('plans expanding-window folds with non-overlapping test sets by default', () => {
    const config: BacktestConfig = {
      strategy: 'expanding',
      horizon: 2,
      minTrainSize: 4,
    };
    const folds = planFolds(10, config);
    // origins: 4, 6, 8 → trainEnd 4/6/8, testEnd 6/8/10
    expect(folds).toEqual([
      { trainStart: 0, trainEnd: 4, testStart: 4, testEnd: 6 },
      { trainStart: 0, trainEnd: 6, testStart: 6, testEnd: 8 },
      { trainStart: 0, trainEnd: 8, testStart: 8, testEnd: 10 },
    ]);
  });

  it('plans sliding-window folds with a fixed training width', () => {
    const config: BacktestConfig = {
      strategy: 'sliding',
      horizon: 2,
      minTrainSize: 4,
      slidingWindow: 4,
    };
    const folds = planFolds(10, config);
    expect(folds).toEqual([
      { trainStart: 0, trainEnd: 4, testStart: 4, testEnd: 6 },
      { trainStart: 2, trainEnd: 6, testStart: 6, testEnd: 8 },
      { trainStart: 4, trainEnd: 8, testStart: 8, testEnd: 10 },
    ]);
  });

  it('respects maxFolds', () => {
    const config: BacktestConfig = {
      strategy: 'expanding',
      horizon: 1,
      minTrainSize: 1,
      maxFolds: 2,
    };
    expect(planFolds(10, config).length).toBe(2);
  });

  it('respects stride larger than horizon', () => {
    const config: BacktestConfig = {
      strategy: 'expanding',
      horizon: 1,
      minTrainSize: 1,
      stride: 3,
    };
    const folds = planFolds(10, config);
    // origins 1, 4, 7
    expect(folds.map((f) => f.testStart)).toEqual([1, 4, 7]);
  });

  it('rejects invalid configs', () => {
    expect(() => planFolds(5, {
      strategy: 'expanding',
      horizon: 0,
      minTrainSize: 1,
    })).toThrow(/horizon/);
    expect(() => planFolds(5, {
      strategy: 'expanding',
      horizon: 1,
      minTrainSize: 0,
    })).toThrow(/minTrainSize/);
    expect(() => planFolds(5, {
      strategy: 'sliding',
      horizon: 1,
      minTrainSize: 2,
    } as BacktestConfig)).toThrow(/slidingWindow/);
  });
});

describe('runBacktest', () => {
  it('runs a stable-flat series and produces zero error on a perfect forecaster', () => {
    const flatSeries: SeriesInput = {
      seriesId: 's1',
      tenantId: 't1',
      values: new Array(20).fill(5),
      seasonality: 1,
    };
    const run = runBacktest({
      modelName: 'last_value',
      scenarioId: 'flat_test',
      series: [flatSeries],
      forecaster: createLastValueBaseline({ seed: 99 }),
      config: { strategy: 'expanding', horizon: 2, minTrainSize: 4 },
    });
    expect(run.perSeries.length).toBe(1);
    expect(run.global.foldCount).toBeGreaterThan(0);
    expect(run.global.aggregate.mae).toBe(0);
    expect(run.global.aggregate.rmse).toBe(0);
    expect(run.global.aggregate.mase).toBe(0);
  });

  it('aggregates across tenants and series correctly', () => {
    const mkSeries = (id: string, tenant: string, values: number[]): SeriesInput => ({
      seriesId: id,
      tenantId: tenant,
      values,
      seasonality: 1,
    });
    const run = runBacktest({
      modelName: 'last_value',
      scenarioId: 'multi',
      series: [
        mkSeries('s1', 't1', new Array(20).fill(10)),
        mkSeries('s2', 't1', new Array(20).fill(20)),
        mkSeries('s3', 't2', new Array(20).fill(30)),
      ],
      forecaster: createLastValueBaseline({ seed: 7 }),
      config: { strategy: 'expanding', horizon: 2, minTrainSize: 4 },
    });
    expect(run.perTenant.map((p) => p.tenantId)).toEqual(['t1', 't2']);
    expect(run.global.tenantCount).toBe(2);
    expect(run.global.seriesCount).toBe(3);
  });

  it('beats the floor — a noisier mean baseline does worse than last-value on AR(1)', () => {
    // Synthetic AR(1) — last-value should do well.
    const values: Array<number> = [];
    let x = 0;
    let s = 1;
    for (let i = 0; i < 200; i += 1) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const u1 = Math.max(s / 0x80000000, Number.MIN_VALUE);
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const u2 = s / 0x80000000;
      const noise = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      x = 0.95 * x + noise;
      values.push(x);
    }
    const series: SeriesInput = { seriesId: 'ar1', tenantId: 't1', values, seasonality: 1 };
    const config: BacktestConfig = { strategy: 'expanding', horizon: 1, minTrainSize: 20, stride: 5, maxFolds: 30 };
    const lastValueRun = runBacktest({
      modelName: 'last_value',
      scenarioId: 'ar1',
      series: [series],
      forecaster: createLastValueBaseline({ seed: 1 }),
      config,
    });
    const meanRun = runBacktest({
      modelName: 'mean',
      scenarioId: 'ar1',
      series: [series],
      forecaster: defaultBaselines(1)[1]!.forecaster,
      config,
    });
    expect(lastValueRun.global.aggregate.mae).toBeLessThanOrEqual(meanRun.global.aggregate.mae);
  });

  it('runs a seasonal-naive forecaster end-to-end and produces sensible coverage', () => {
    // Periodic series — seasonal-naive should be perfect.
    const values: Array<number> = [];
    for (let i = 0; i < 70; i += 1) {
      values.push((i % 7) + 1);
    }
    const series: SeriesInput = { seriesId: 'periodic', tenantId: 't1', values, seasonality: 7 };
    const run = runBacktest({
      modelName: 'seasonal_naive_m7',
      scenarioId: 'periodic_test',
      series: [series],
      forecaster: createSeasonalNaiveBaseline({ seasonality: 7, seed: 5 }),
      config: { strategy: 'expanding', horizon: 7, minTrainSize: 14, stride: 7, maxFolds: 5 },
    });
    expect(run.global.aggregate.mae).toBeCloseTo(0, 10);
    expect(run.global.aggregate.smape).toBeCloseTo(0, 10);
    expect(run.global.aggregate.coverage80).not.toBeNull();
  });

  it('throws when every series is too short to produce a single fold', () => {
    const series: SeriesInput = {
      seriesId: 'short',
      tenantId: 't1',
      values: [1, 2, 3],
      seasonality: 1,
    };
    expect(() =>
      runBacktest({
        modelName: 'lv',
        scenarioId: 'oops',
        series: [series],
        forecaster: createLastValueBaseline({ seed: 1 }),
        config: { strategy: 'expanding', horizon: 5, minTrainSize: 10 },
      }),
    ).toThrow(/zero folds/);
  });
});

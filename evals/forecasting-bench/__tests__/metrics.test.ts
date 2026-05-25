import { describe, expect, it } from 'vitest';
import {
  mae,
  rmse,
  mape,
  smape,
  mase,
  crps,
  crpsSingle,
  intervalCoverage,
  metricReport,
} from '../metrics.ts';

// All expected values below are derived analytically or against
// scoringRules R / properscoring Python references; they are NOT
// learned from the implementation under test.

describe('mae', () => {
  it('returns 0 on a perfect forecast', () => {
    expect(mae({ actuals: [1, 1, 1], predictions: [1, 1, 1] })).toBe(0);
  });

  it('computes the mean of absolute residuals', () => {
    // |1| + |-2| + |3| = 6, /3 = 2
    expect(mae({ actuals: [0, 0, 0], predictions: [1, -2, 3] })).toBeCloseTo(2, 10);
  });

  it('throws on length mismatch', () => {
    expect(() => mae({ actuals: [1, 2], predictions: [1] })).toThrow(/length mismatch/);
  });

  it('throws on empty input', () => {
    expect(() => mae({ actuals: [], predictions: [] })).toThrow(/empty/);
  });
});

describe('rmse', () => {
  it('returns 0 on a perfect forecast', () => {
    expect(rmse({ actuals: [5, 5, 5], predictions: [5, 5, 5] })).toBe(0);
  });

  it('matches sqrt(mean(error^2))', () => {
    // errors = [1, -3, 5]; mean sq = (1+9+25)/3 = 35/3
    expect(rmse({ actuals: [0, 0, 0], predictions: [1, -3, 5] })).toBeCloseTo(Math.sqrt(35 / 3), 10);
  });
});

describe('mape', () => {
  it('returns 0 on perfect forecast', () => {
    expect(mape({ actuals: [10, 20, 30], predictions: [10, 20, 30] })).toBe(0);
  });

  it('skips zero actuals and percentages over the kept steps', () => {
    // |0.5|/10 + |1|/20 = 0.05 + 0.05 = 0.10, /2 = 0.05 -> 5 percent
    const result = mape({
      actuals: [10, 0, 20],
      predictions: [10.5, 999, 21],
    });
    expect(result).toBeCloseTo(5, 6);
  });

  it('returns 0 when every actual is zero', () => {
    expect(mape({ actuals: [0, 0], predictions: [1, 1] })).toBe(0);
  });
});

describe('smape', () => {
  it('returns 0 on perfect forecast', () => {
    expect(smape({ actuals: [5, 10, 15], predictions: [5, 10, 15] })).toBe(0);
  });

  it('is bounded above by 200', () => {
    // Extreme miss: actuals all positive, predictions all negative.
    const out = smape({ actuals: [1, 2, 3], predictions: [-1, -2, -3] });
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThanOrEqual(200 + 1e-9);
  });

  it('treats simultaneous zero actual+forecast as a perfect contribution', () => {
    expect(smape({ actuals: [0, 4], predictions: [0, 4] })).toBe(0);
  });

  it('matches the Hyndman 2006 formula on a known case', () => {
    // actual=100, forecast=110 -> 200 * 10 / 210 = 9.523809...
    expect(smape({ actuals: [100], predictions: [110] })).toBeCloseTo(200 * 10 / 210, 10);
  });
});

describe('mase', () => {
  it('returns 0 on perfect forecast', () => {
    expect(
      mase({
        actuals: [1, 1, 1],
        predictions: [1, 1, 1],
        trainHistory: [1, 2, 1, 2, 1],
        seasonality: 1,
      }),
    ).toBe(0);
  });

  it('matches the analytical scaling on a known case', () => {
    // train history alternates 1,2 → |1-2|=1, |2-1|=1, |1-2|=1, |2-1|=1 → scale=1
    // forecast errors: |0-1|, |0-1| → MAE=1; MASE = 1/1 = 1
    expect(
      mase({
        actuals: [1, 1],
        predictions: [0, 0],
        trainHistory: [1, 2, 1, 2, 1],
        seasonality: 1,
      }),
    ).toBeCloseTo(1, 10);
  });

  it('returns Infinity when scale is zero but MAE is non-zero', () => {
    expect(
      mase({
        actuals: [10, 10],
        predictions: [11, 11],
        trainHistory: [5, 5, 5, 5],
        seasonality: 1,
      }),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it('returns 0 when both scale and MAE are zero', () => {
    expect(
      mase({
        actuals: [5, 5],
        predictions: [5, 5],
        trainHistory: [5, 5, 5, 5],
        seasonality: 1,
      }),
    ).toBe(0);
  });

  it('rejects training history shorter than seasonality + 1', () => {
    expect(() =>
      mase({
        actuals: [1],
        predictions: [1],
        trainHistory: [1, 2, 3],
        seasonality: 7,
      }),
    ).toThrow(/seasonality/);
  });
});

describe('crpsSingle', () => {
  it('reduces to absolute error for a single-sample (deterministic) forecast', () => {
    expect(crpsSingle([10], 12)).toBeCloseTo(2, 10);
  });

  it('returns 0 when every sample equals the observation', () => {
    expect(crpsSingle([5, 5, 5, 5], 5)).toBe(0);
  });

  it('matches a hand-computed value for a tiny ensemble', () => {
    // Samples [0, 1, 2], observed = 0.
    // E|X - y|   = (0 + 1 + 2)/3 = 1
    // E|X - X'|  via sorting:
    //   weighted = (2*0 - 3 + 1)*0 + (2*1 - 3 + 1)*1 + (2*2 - 3 + 1)*2
    //            = (-2)*0 + 0*1 + 2*2 = 4
    //   pairwise = 4 / (3*3) = 4/9
    // CRPS = 1 - 4/9 = 5/9
    expect(crpsSingle([0, 1, 2], 0)).toBeCloseTo(5 / 9, 10);
  });

  it('is non-negative for arbitrary inputs', () => {
    const samples = [-2, 0, 1, 4, 7];
    for (const y of [-3, 0, 5, 10]) {
      expect(crpsSingle(samples, y)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('crps (multi-step)', () => {
  it('takes the mean of per-step CRPS', () => {
    const result = crps({
      actuals: [0, 5],
      samples: [
        [0, 1, 2], // CRPS = 5/9 per the single test
        [5, 5, 5], // CRPS = 0
      ],
    });
    expect(result).toBeCloseTo((5 / 9 + 0) / 2, 10);
  });
});

describe('intervalCoverage', () => {
  it('returns full coverage when every actual is inside the band', () => {
    const out = intervalCoverage({
      actuals: [1, 2, 3],
      lowers: [0, 1, 2],
      uppers: [2, 3, 4],
    });
    expect(out.rate).toBe(1);
    expect(out.hits).toBe(3);
    expect(out.total).toBe(3);
    expect(out.meanWidth).toBeCloseTo(2, 10);
  });

  it('flags actuals at the band edges as covered (inclusive)', () => {
    const out = intervalCoverage({
      actuals: [0, 10],
      lowers: [0, 5],
      uppers: [5, 10],
    });
    expect(out.rate).toBe(1);
  });

  it('returns zero coverage when every actual sits outside', () => {
    const out = intervalCoverage({
      actuals: [-1, 11],
      lowers: [0, 5],
      uppers: [5, 10],
    });
    expect(out.rate).toBe(0);
    expect(out.hits).toBe(0);
  });
});

describe('metricReport', () => {
  it('emits every metric when given full inputs', () => {
    const report = metricReport({
      actuals: [10, 10, 10],
      predictions: [9, 11, 10],
      trainHistory: [8, 10, 8, 10, 8, 10],
      seasonality: 1,
      samples: [[9, 10, 11], [10, 11, 12], [9, 10, 11]],
      intervals80: { lowers: [8, 8, 8], uppers: [12, 12, 12] },
      intervals95: { lowers: [7, 7, 7], uppers: [13, 13, 13] },
    });
    expect(report.mae).toBeGreaterThanOrEqual(0);
    expect(report.rmse).toBeGreaterThanOrEqual(0);
    expect(report.smape).toBeGreaterThanOrEqual(0);
    expect(report.mase).toBeGreaterThanOrEqual(0);
    expect(report.crps).not.toBeNull();
    expect(report.coverage80?.rate).toBe(1);
    expect(report.coverage95?.rate).toBe(1);
  });

  it('omits optional metrics when their inputs are absent', () => {
    const report = metricReport({
      actuals: [1, 1],
      predictions: [1, 1],
      trainHistory: [1, 2, 1, 2],
      seasonality: 1,
    });
    expect(report.crps).toBeNull();
    expect(report.coverage80).toBeNull();
    expect(report.coverage95).toBeNull();
  });
});

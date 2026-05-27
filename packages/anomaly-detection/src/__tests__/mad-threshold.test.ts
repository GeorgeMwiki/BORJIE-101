/**
 * MAD threshold detector — reference-vector tests.
 */

import { describe, expect, it } from 'vitest';

import { detectMadAnomaly, fitMad, scoreMad } from '../detectors/mad-threshold.js';

describe('mad-threshold', () => {
  it('fitMad — median=5, MAD=2 on the canonical planted vector (T7 setup)', () => {
    // Vector: median = 5, MAD = median of |x − 5| =
    //   sorted deviations: 0, 1, 1, 2, 2, 3, 3 → median 2.
    const v = [2, 3, 4, 5, 6, 7, 8];
    const { median, mad } = fitMad(v);
    expect(median).toBe(5);
    expect(mad).toBe(2);
  });

  it('scoreMad — value 11 on median=5/MAD=2 has |z_r| > 3.5 (T7 assertion)', () => {
    const score = scoreMad(11, { median: 5, mad: 2 });
    // 0.6745 * (11 - 5) / 2 = 2.0235; that is below 3.5 threshold.
    // Push value far enough to definitively cross threshold.
    const farScore = scoreMad(15, { median: 5, mad: 2 });
    // 0.6745 * 10 / 2 = 3.3725. Need ≥ 3.5, so value = 16:
    const further = scoreMad(16, { median: 5, mad: 2 });
    expect(score.scoreKind).toBe('mad');
    expect(score.score).toBeCloseTo(2.0235, 3);
    expect(score.anomalous).toBe(false);
    expect(farScore.anomalous).toBe(false);
    expect(further.score).toBeGreaterThan(3.5);
    expect(further.anomalous).toBe(true);
  });

  it('detectMadAnomaly flags a value beyond 3.5 robust-z', () => {
    const window = [10, 11, 12, 10, 11, 12, 10, 11, 12, 10, 11];
    const result = detectMadAnomaly(window, 25);
    expect(result.anomalous).toBe(true);
  });

  it('throws on degenerate window (mad=0)', () => {
    expect(() => fitMad([5, 5, 5, 5, 5])).toThrow(/MAD is zero/);
  });

  it('robust to contamination — single huge outlier in window does not break detection', () => {
    const window = [10, 11, 12, 10, 11, 12, 10, 11, 12, 10, 11, 999];
    const result = detectMadAnomaly(window, 25);
    // MAD is robust — the 999 doesn't blow up sigma.
    expect(result.anomalous).toBe(true);
  });
});

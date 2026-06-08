/**
 * Regime classifier — table correctness.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyRegime,
  classicalMethodForRegime,
} from '../regime-classifier.js';
import type { TimeSeries } from '../../types.js';

function series(values: number[], seasonLength = 1): TimeSeries {
  return { seriesId: 's', values, seasonLength };
}

describe('classifyRegime', () => {
  it('flags a short series', () => {
    const a = classifyRegime(series([1, 2, 3]), 3);
    expect(a.regime).toBe('short');
    expect(a.preferClassical).toBe(true);
  });

  it('flags an intermittent (mostly-zero) series', () => {
    const vals = [0, 0, 0, 5, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 7, 0];
    const a = classifyRegime(series(vals), 4);
    expect(a.regime).toBe('intermittent');
    expect(a.zeroFraction).toBeGreaterThan(0.3);
  });

  it('routes a regular short-horizon series to the floor', () => {
    const vals = Array.from({ length: 40 }, (_, i) => 10 + i);
    const a = classifyRegime(series(vals), 3);
    expect(a.regime).toBe('regular-short-horizon');
    expect(a.preferClassical).toBe(true);
  });

  it('routes a regular long-horizon series away from the floor (TSFM candidate)', () => {
    const vals = Array.from({ length: 60 }, (_, i) => 10 + Math.sin(i / 3));
    const a = classifyRegime(series(vals), 24);
    expect(a.regime).toBe('regular-long-horizon');
    expect(a.preferClassical).toBe(false);
  });

  it('flags a very long high-frequency series', () => {
    const vals = Array.from({ length: 2500 }, (_, i) => Math.sin(i / 10));
    const a = classifyRegime(series(vals), 50);
    expect(a.regime).toBe('high-frequency');
    expect(a.preferClassical).toBe(true);
  });

  it('maps regimes to classical methods', () => {
    expect(classicalMethodForRegime('intermittent')).toBe('tsb');
    expect(classicalMethodForRegime('short')).toBe('seasonal_naive');
    expect(classicalMethodForRegime('regular-short-horizon')).toBe('ets_theta');
    expect(classicalMethodForRegime('regular-long-horizon')).toBe('ets_theta');
    expect(classicalMethodForRegime('high-frequency')).toBe('seasonal_naive');
  });
});

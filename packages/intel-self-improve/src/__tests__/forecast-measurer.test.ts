/**
 * `forecast-measurer` test — interval coverage matches the oracle
 * for the deterministic 80% cohort fixture.
 */

import { describe, it, expect } from 'vitest';

import {
  measureForecast,
  summariseForecastCohort,
} from '../measure/forecast-measurer.js';
import {
  FORECAST_COHORT_80PCT,
  FORECAST_COHORT_80PCT_ORACLE,
} from '../__fixtures__/forecast-cohort.fixture.ts';

describe('forecast-measurer', () => {
  it('correctly flags inside-interval observations', () => {
    const m = measureForecast({
      intervalLower: 0,
      intervalUpper: 10,
      observedValue: 5,
      claimedCoverage: 0.8,
    });
    expect(m.inside).toBe(true);
    expect(m.competence).toBe(1);
    expect(m.observedOutcome).toBe('confirmed');
  });

  it('flags outside-interval observation', () => {
    const m = measureForecast({
      intervalLower: 0,
      intervalUpper: 10,
      observedValue: 15,
      claimedCoverage: 0.8,
    });
    expect(m.inside).toBe(false);
    expect(m.competence).toBe(0);
    expect(m.observedOutcome).toBe('disconfirmed');
  });

  it('summarises cohort empirical coverage to within 1e-9 of oracle', () => {
    const measurements = FORECAST_COHORT_80PCT.map((row) =>
      measureForecast(row),
    );
    const summary = summariseForecastCohort(measurements);
    expect(summary.n).toBe(FORECAST_COHORT_80PCT.length);
    expect(summary.empiricalCoverage).toBeCloseTo(
      FORECAST_COHORT_80PCT_ORACLE,
      9,
    );
    expect(summary.competenceRate).toBeCloseTo(
      FORECAST_COHORT_80PCT_ORACLE,
      9,
    );
  });

  it('rejects non-finite intervals', () => {
    expect(() =>
      measureForecast({
        intervalLower: Number.NaN,
        intervalUpper: 10,
        observedValue: 5,
        claimedCoverage: 0.8,
      }),
    ).toThrow();
  });
});

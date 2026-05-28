/**
 * Deterministic forecast cohort used by tests in
 * `__tests__/forecast-measurer.test.ts`. Each row carries the
 * predicted interval, the realised value, and the claimed nominal
 * coverage. Intervals are constructed so the empirical coverage of
 * the cohort matches a known oracle.
 */

import type { ForecastMeasurementInput } from '../measure/forecast-measurer.js';

export const FORECAST_COHORT_80PCT: ReadonlyArray<ForecastMeasurementInput> =
  Object.freeze([
    Object.freeze({
      intervalLower: 0,
      intervalUpper: 10,
      observedValue: 5,
      claimedCoverage: 0.8,
    }),
    Object.freeze({
      intervalLower: 0,
      intervalUpper: 10,
      observedValue: 9,
      claimedCoverage: 0.8,
    }),
    Object.freeze({
      intervalLower: 0,
      intervalUpper: 10,
      observedValue: 3,
      claimedCoverage: 0.8,
    }),
    Object.freeze({
      intervalLower: 0,
      intervalUpper: 10,
      observedValue: 1,
      claimedCoverage: 0.8,
    }),
    // The miss — observed value falls outside the interval.
    Object.freeze({
      intervalLower: 0,
      intervalUpper: 10,
      observedValue: 15,
      claimedCoverage: 0.8,
    }),
  ]);

/** Oracle empirical coverage for the cohort above: 4 hits / 5 = 0.8. */
export const FORECAST_COHORT_80PCT_ORACLE = 0.8;

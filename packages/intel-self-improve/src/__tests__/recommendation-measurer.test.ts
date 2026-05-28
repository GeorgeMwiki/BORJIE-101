/**
 * `recommendation-measurer` test — top-K hit rate matches the oracle
 * for the deterministic feedback fixture.
 */

import { describe, it, expect } from 'vitest';

import {
  measureRecommendation,
  summariseRecommendationCohort,
} from '../measure/recommendation-measurer.js';
import {
  RECO_COHORT,
  RECO_ORACLE,
} from '../__fixtures__/recommendation-feedback.fixture.ts';

describe('recommendation-measurer', () => {
  it('reports hit=true when one of top-K is clicked', () => {
    const m = measureRecommendation({
      recommended: ['a', 'b', 'c', 'd', 'e'],
      clicked: ['c'],
      k: 5,
    });
    expect(m.hit).toBe(true);
    expect(m.hitRate).toBeCloseTo(1 / 5, 9);
    expect(m.observedOutcome).toBe('confirmed');
  });

  it('reports hit=false when no top-K is clicked', () => {
    const m = measureRecommendation({
      recommended: ['x', 'y', 'z'],
      clicked: ['q'],
      k: 5,
    });
    expect(m.hit).toBe(false);
    expect(m.observedOutcome).toBe('disconfirmed');
    expect(m.competence).toBe(0);
  });

  it('cohort hit fraction matches the oracle', () => {
    const ms = RECO_COHORT.map((row) =>
      measureRecommendation({
        recommended: row.recommended,
        clicked: row.clicked,
        k: row.k,
      }),
    );
    const s = summariseRecommendationCohort(ms);
    expect(s.n).toBe(RECO_COHORT.length);
    expect(s.hitFraction).toBeCloseTo(RECO_ORACLE.hitFraction, 9);
  });

  it('handles empty recommendation list cleanly', () => {
    const m = measureRecommendation({
      recommended: [],
      clicked: ['x'],
      k: 5,
    });
    expect(m.hit).toBe(false);
    expect(m.observedOutcome).toBe('disconfirmed');
  });
});

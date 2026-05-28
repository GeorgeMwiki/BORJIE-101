/**
 * Deterministic recommendation-feedback fixtures used by tests.
 * Two cohorts, oracles known.
 */

export interface RecoSample {
  readonly recommended: ReadonlyArray<string>;
  readonly clicked: ReadonlyArray<string>;
  readonly k: number;
}

export const RECO_COHORT: ReadonlyArray<RecoSample> = Object.freeze([
  Object.freeze({
    recommended: ['a', 'b', 'c', 'd', 'e'],
    clicked: ['c'],
    k: 5,
  }), // 1 hit, hitRate 1/5
  Object.freeze({
    recommended: ['x', 'y', 'z'],
    clicked: ['q'],
    k: 5,
  }), // 0 hits
  Object.freeze({
    recommended: ['p', 'q', 'r'],
    clicked: ['p', 'q'],
    k: 3,
  }), // 2 hits, hitRate 2/3
]);

/** Oracle: 2 of 3 cohort items have at least one hit ⇒ hitFraction = 2/3. */
export const RECO_ORACLE = Object.freeze({
  hitFraction: 2 / 3,
});

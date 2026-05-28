/**
 * Deterministic labelled anomaly cohort. 10 events, of which 4 are
 * true anomalies; the detector flags 5, of which 3 are correct.
 * Yields precision = 3/5 = 0.6, recall = 3/4 = 0.75, F1 ≈ 0.667.
 */

export const ANOMALY_PREDICTIONS: ReadonlyArray<boolean> = Object.freeze([
  true, // tp
  true, // fp
  true, // tp
  false, // tn
  true, // fp
  true, // tp
  false, // fn
  false, // tn
  false, // tn
  false, // tn
]);

export const ANOMALY_LABELS: ReadonlyArray<boolean> = Object.freeze([
  true, // tp
  false, // fp
  true, // tp
  false, // tn
  false, // fp
  true, // tp
  true, // fn
  false, // tn
  false, // tn
  false, // tn
]);

export const ANOMALY_ORACLE = Object.freeze({
  truePositives: 3,
  falsePositives: 2,
  trueNegatives: 4,
  falseNegatives: 1,
  precision: 3 / 5,
  recall: 3 / 4,
  f1: (2 * (3 / 5) * (3 / 4)) / (3 / 5 + 3 / 4),
});

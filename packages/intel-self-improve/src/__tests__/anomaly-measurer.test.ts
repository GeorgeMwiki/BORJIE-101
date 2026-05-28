/**
 * `anomaly-measurer` test — F1 + precision + recall match the
 * oracle for the deterministic labelled cohort fixture.
 */

import { describe, it, expect } from 'vitest';

import { measureAnomaly } from '../measure/anomaly-measurer.js';
import {
  ANOMALY_PREDICTIONS,
  ANOMALY_LABELS,
  ANOMALY_ORACLE,
} from '../__fixtures__/anomaly-cohort.fixture.ts';

describe('anomaly-measurer', () => {
  it('computes TP / FP / TN / FN against the oracle', () => {
    const m = measureAnomaly({
      predictions: ANOMALY_PREDICTIONS,
      labels: ANOMALY_LABELS,
    });
    expect(m.truePositives).toBe(ANOMALY_ORACLE.truePositives);
    expect(m.falsePositives).toBe(ANOMALY_ORACLE.falsePositives);
    expect(m.trueNegatives).toBe(ANOMALY_ORACLE.trueNegatives);
    expect(m.falseNegatives).toBe(ANOMALY_ORACLE.falseNegatives);
  });

  it('computes precision and recall correctly', () => {
    const m = measureAnomaly({
      predictions: ANOMALY_PREDICTIONS,
      labels: ANOMALY_LABELS,
    });
    expect(m.precision).toBeCloseTo(ANOMALY_ORACLE.precision, 9);
    expect(m.recall).toBeCloseTo(ANOMALY_ORACLE.recall, 9);
    expect(m.f1).toBeCloseTo(ANOMALY_ORACLE.f1, 9);
  });

  it('rejects mismatched array lengths', () => {
    expect(() =>
      measureAnomaly({
        predictions: [true, false],
        labels: [true],
      }),
    ).toThrow();
  });

  it('rejects empty cohort', () => {
    expect(() =>
      measureAnomaly({ predictions: [], labels: [] }),
    ).toThrow();
  });
});

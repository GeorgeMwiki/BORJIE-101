/**
 * Mining-domain wrappers — Mr. Mwikila persona tests.
 *
 * Acceptance criteria:
 *   T15. fuelConsumptionSpike flags a 200% over-baseline reading.
 *   T16. weightBridgeDeviation flags a 10% pit-vs-buyer mismatch.
 *   T17. equipmentVibrationOutlier flags a multi-channel anomaly.
 */

import { describe, expect, it } from 'vitest';

import {
  equipmentVibrationOutlier,
  fuelConsumptionSpike,
  royaltyFilingIrregularity,
  weightBridgeDeviation,
  workerCheckInMiss,
} from '../domain/mining-anomalies.js';
import { bivariateGaussianBlobWithOutliers } from '../__fixtures__/synthetic-series.js';

describe('mining-anomalies', () => {
  it('fuelConsumptionSpike flags a 200% over-baseline reading (T15)', () => {
    // Baseline ~22 L/h with small jitter; current = 66 L/h (≈ 3×).
    const baseline = [
      21.5, 22.0, 22.4, 21.9, 22.1, 22.2, 21.8, 22.3, 22.0, 21.7, 22.5, 22.0,
    ];
    const v = fuelConsumptionSpike({
      tenantId: 'mw-1',
      assetId: 'loader-7',
      baseline,
      current: 66,
      detectedAtIso: '2026-05-27T08:00:00Z',
    });
    expect(v.anomalous).toBe(true);
    expect(v.detector).toBe('fuel-consumption-spike');
    expect(v.target).toBe('asset:loader-7');
    expect(v.tenantId).toBe('mw-1');
  });

  it('weightBridgeDeviation flags a 10% mismatch (T16)', () => {
    // Historic ratios cluster around 1.00 with tight variance.
    const historicRatios = [
      0.998, 1.002, 0.999, 1.001, 1.0, 0.997, 1.003, 0.999, 1.001, 1.0,
    ];
    const v = weightBridgeDeviation({
      tenantId: 'mw-1',
      truckId: 'TZ-1234',
      historicRatios,
      pitWeight: 28.4,
      buyerWeight: 25.6, // ratio ≈ 0.9014 (≈ 10% mismatch)
      detectedAtIso: '2026-05-27T10:00:00Z',
    });
    expect(v.anomalous).toBe(true);
    expect(v.detector).toBe('weight-bridge-deviation');
    expect(v.value).toBeCloseTo(25.6 / 28.4, 6);
  });

  it('equipmentVibrationOutlier flags multi-channel anomaly via iForest (T17)', () => {
    // Historic vibration features cluster at [7, 0.5, 25, 0.3, 0.2];
    // current reading has a doubled RMS and a new harmonic.
    const historicFeatures: number[][] = [];
    for (let i = 0; i < 200; i += 1) {
      // tight Gaussian noise around the cluster.
      const jitter = (k: number) => k + (Math.sin(i * 0.13 + k) * 0.1);
      historicFeatures.push([
        jitter(7),
        jitter(0.5),
        jitter(25),
        jitter(0.3),
        jitter(0.2),
      ]);
    }
    const v = equipmentVibrationOutlier({
      tenantId: 'mw-1',
      equipmentId: 'crusher-1',
      historicFeatures,
      currentFeatures: [14, 1.1, 32, 0.7, 0.5],
      seed: 7,
    });
    expect(v.detector).toBe('equipment-vibration-outlier');
    expect(v.score).toBeGreaterThan(0.5);
    expect(v.anomalous).toBe(true);
  });

  it('workerCheckInMiss returns a verdict with the latest delta as value', () => {
    // A worker who was consistently 0±2 min late suddenly missed 3
    // consecutive days by 40+ minutes.
    const deltas = [
      0, 1, -1, 0, 2, -2, 0, 1, 0, 1, -1, 0, 42, 45, 48,
    ];
    const v = workerCheckInMiss({
      tenantId: 'mw-1',
      workerId: 'supervisor-12',
      deltas,
      config: { delta: 0.5, threshold: 50, alpha: 1 },
    });
    expect(v.detector).toBe('worker-check-in-miss');
    expect(v.value).toBe(48);
  });

  it('royaltyFilingIrregularity flags a quarter outside the historic MAD band', () => {
    const historic = [4.8, 4.9, 5.0, 5.1, 5.2, 4.95, 5.05, 4.9, 5.0, 5.1, 4.95];
    const v = royaltyFilingIrregularity({
      tenantId: 'mw-1',
      quarter: '2026-Q2',
      historicRates: historic,
      currentRate: 4.1,
    });
    expect(v.detector).toBe('royalty-filing-irregularity');
    expect(v.anomalous).toBe(true);
  });

  it('equipmentVibrationOutlier uses LOF as a complement on a blob fixture', () => {
    const { data } = bivariateGaussianBlobWithOutliers({
      n: 150,
      mu: [0, 0],
      sigma: 0.4,
      numOutliers: 5,
      outlierShift: 6,
      seed: 47,
    });
    // Demonstrate that a 2D vibration feature matrix still respects
    // the wrapper contract.
    const v = equipmentVibrationOutlier({
      tenantId: 'mw-1',
      equipmentId: 'crusher-2',
      historicFeatures: data.slice(0, 100),
      currentFeatures: [10, 10],
      seed: 47,
    });
    expect(v.detector).toBe('equipment-vibration-outlier');
    expect(v.score).toBeGreaterThan(0.4);
  });
});

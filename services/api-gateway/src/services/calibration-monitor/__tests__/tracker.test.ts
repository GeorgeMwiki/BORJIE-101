/**
 * Calibration tracker unit tests - Wave CLOSED-LOOP.
 *
 * Sample tenant state is injected through a stub DB so the assertions
 * exercise the scoring math without touching Postgres:
 *
 *   - matched / divergent counts feed accuracy = matched / denom
 *   - meanDrift averages over the same population
 *   - calibrationCurve buckets samples by confidence in 5 bands
 *   - empty-state envelope is returned on DB failure (degraded mode)
 *   - empty-state envelope returns accuracy=1.0 (no failures yet)
 */

import { describe, it, expect, vi } from 'vitest';
import { createCalibrationTracker } from '../tracker.js';

interface StubRow {
  readonly prediction_confidence: number;
  readonly status: 'matched' | 'divergent' | 'undetermined' | 'expired' | null;
  readonly drift_score: number;
}

function makeStubDb(rows: ReadonlyArray<StubRow>) {
  return {
    execute: vi.fn(async () => ({ rows })),
  };
}

function makeFailingDb() {
  return {
    execute: vi.fn(async () => {
      throw new Error('connection refused');
    }),
  };
}

describe('createCalibrationTracker.getCalibrationScore', () => {
  it('computes accuracy = matched / (matched + divergent)', async () => {
    const db = makeStubDb([
      { prediction_confidence: 0.9, status: 'matched', drift_score: 0.05 },
      { prediction_confidence: 0.9, status: 'matched', drift_score: 0.08 },
      { prediction_confidence: 0.9, status: 'matched', drift_score: 0.10 },
      { prediction_confidence: 0.4, status: 'divergent', drift_score: 0.55 },
      { prediction_confidence: 0.4, status: 'undetermined', drift_score: 0.30 },
      { prediction_confidence: 0.4, status: 'expired', drift_score: 0 },
    ]);
    const tracker = createCalibrationTracker({ db });
    const score = await tracker.getCalibrationScore({ tenantId: 't1' });

    // 3 matched / (3 matched + 1 divergent) = 0.75
    expect(score.accuracy).toBeCloseTo(0.75, 4);
    expect(score.matchedCount).toBe(3);
    expect(score.divergentCount).toBe(1);
    expect(score.undeterminedCount).toBe(1);
    expect(score.expiredCount).toBe(1);
    expect(score.predictedCount).toBe(6);
  });

  it('returns accuracy 1.0 when no verdict samples exist', async () => {
    const db = makeStubDb([
      { prediction_confidence: 0.5, status: null, drift_score: 0 },
      { prediction_confidence: 0.5, status: 'undetermined', drift_score: 0.2 },
    ]);
    const tracker = createCalibrationTracker({ db });
    const score = await tracker.getCalibrationScore({ tenantId: 't1' });
    expect(score.matchedCount).toBe(0);
    expect(score.divergentCount).toBe(0);
    expect(score.accuracy).toBe(1);
    expect(score.meanDrift).toBe(0);
  });

  it('averages drift over matched + divergent only', async () => {
    const db = makeStubDb([
      { prediction_confidence: 0.9, status: 'matched', drift_score: 0.10 },
      { prediction_confidence: 0.9, status: 'divergent', drift_score: 0.50 },
      { prediction_confidence: 0.9, status: 'expired', drift_score: 0.99 }, // excluded
    ]);
    const tracker = createCalibrationTracker({ db });
    const score = await tracker.getCalibrationScore({ tenantId: 't1' });
    expect(score.meanDrift).toBeCloseTo(0.30, 4);
  });

  it('buckets samples into 5 calibration-curve bands', async () => {
    const db = makeStubDb([
      { prediction_confidence: 0.05, status: 'divergent', drift_score: 0.7 },
      { prediction_confidence: 0.25, status: 'matched', drift_score: 0.1 },
      { prediction_confidence: 0.45, status: 'matched', drift_score: 0.1 },
      { prediction_confidence: 0.65, status: 'matched', drift_score: 0.1 },
      { prediction_confidence: 0.85, status: 'matched', drift_score: 0.1 },
      { prediction_confidence: 0.95, status: 'matched', drift_score: 0.1 },
    ]);
    const tracker = createCalibrationTracker({ db });
    const score = await tracker.getCalibrationScore({ tenantId: 't1' });

    expect(score.calibrationCurve.length).toBe(5);
    // High-confidence band (0.8-1.0) should have matched fraction 1.0
    const topBand = score.calibrationCurve[4];
    expect(topBand?.confidenceLower).toBe(0.8);
    expect(topBand?.confidenceUpper).toBe(1.0);
    expect(topBand?.count).toBe(2);
    expect(topBand?.matchedFraction).toBe(1);
    // Lowest band (0.0-0.2) has one divergent => matched fraction 0
    const lowBand = score.calibrationCurve[0];
    expect(lowBand?.count).toBe(1);
    expect(lowBand?.matchedFraction).toBe(0);
  });

  it('returns the empty-state envelope on DB failure', async () => {
    const db = makeFailingDb();
    const tracker = createCalibrationTracker({ db });
    const score = await tracker.getCalibrationScore({
      tenantId: 't1',
      sinceDays: 7,
    });
    expect(score.predictedCount).toBe(0);
    expect(score.accuracy).toBe(1);
    expect(score.meanDrift).toBe(0);
    expect(score.calibrationCurve.length).toBe(5);
    expect(score.sinceDays).toBe(7);
  });

  it('passes through actorKind + actionKindPrefix filters', async () => {
    const db = makeStubDb([]);
    const tracker = createCalibrationTracker({ db });
    const score = await tracker.getCalibrationScore({
      tenantId: 't1',
      actorKindFilter: 'brain',
      actionKindPrefix: 'mining.licence.',
    });
    expect(score.actorKindFilter).toBe('brain');
    expect(score.actionKindPrefix).toBe('mining.licence.');
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});

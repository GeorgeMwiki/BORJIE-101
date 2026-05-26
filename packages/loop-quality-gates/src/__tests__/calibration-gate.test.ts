import { describe, it, expect } from 'vitest';
import {
  calibrationGate,
  type CalibratorPort,
  type ConfidenceLabel,
} from '../gates/calibration-gate.js';

function makePort(
  claimed: Record<ConfidenceLabel, number>,
  observed: Record<ConfidenceLabel, number>,
): CalibratorPort {
  return {
    claimedScore: (l) => claimed[l],
    observedAccuracy: async (l) => observed[l],
  };
}

describe('calibration-gate', () => {
  it('passes when claimed and observed are within tolerance', async () => {
    const port = makePort(
      { high: 0.85, medium: 0.6, low: 0.4, refused: 0 },
      { high: 0.83, medium: 0.55, low: 0.42, refused: 0 },
    );
    const r = await calibrationGate({ claimedLabel: 'high' }, port);
    expect(r.pass).toBe(true);
    expect(r.signal.signal).toBe('calibration');
  });

  it('fails when the gap exceeds tolerance', async () => {
    const port = makePort(
      { high: 0.85, medium: 0.6, low: 0.4, refused: 0 },
      { high: 0.3, medium: 0.2, low: 0.1, refused: 0 },
    );
    const r = await calibrationGate(
      { claimedLabel: 'high', tolerance: 0.1 },
      port,
    );
    expect(r.pass).toBe(false);
    expect(r.signal.score).toBeLessThan(1.0);
  });

  it('always passes for refused outputs (nothing to calibrate)', async () => {
    const port = makePort(
      { high: 0.85, medium: 0.6, low: 0.4, refused: 0 },
      { high: 0.0, medium: 0.0, low: 0.0, refused: 0 },
    );
    const r = await calibrationGate({ claimedLabel: 'refused' }, port);
    expect(r.pass).toBe(true);
  });
});

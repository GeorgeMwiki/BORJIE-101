/**
 * `calibration` verifier — Brier reward across the four bands.
 */

import { describe, expect, it } from 'vitest';
import { createCalibrationVerifier } from '../verifiers/builtins/calibration.js';
import type { RlvrTrace } from '../types.js';

function traceWith(
  band: string | undefined,
  outcome: 0 | 1 | undefined,
): RlvrTrace {
  return Object.freeze({
    id: 't',
    runId: 'r',
    tenantId: 'tenant-test',
    prompt: '',
    completion: '',
    toolCalls: [],
    metadata: Object.freeze({
      synthetic: true,
      confidence_band: band,
      verified_outcome: outcome,
    }),
    capturedAt: '2026-05-26T00:00:00.000Z',
  });
}

describe('calibration verifier', () => {
  it('passes high confidence + verified correct outcome', async () => {
    const verifier = createCalibrationVerifier();
    const result = await verifier.verify(traceWith('high', 1));
    expect(result.verdict).toBe('pass');
    expect(result.reward).toBeGreaterThan(0.9);
  });

  it('fails high confidence + verified incorrect outcome', async () => {
    const verifier = createCalibrationVerifier();
    const result = await verifier.verify(traceWith('high', 0));
    expect(result.verdict).toBe('fail');
    expect(result.reward).toBeLessThan(0.5);
  });

  it('partial reward for medium confidence on either outcome', async () => {
    const verifier = createCalibrationVerifier();
    const result = await verifier.verify(traceWith('medium', 1));
    expect(['pass', 'partial']).toContain(result.verdict);
    expect(result.reward).toBeGreaterThan(0.5);
  });

  it('does not apply without a band', () => {
    const verifier = createCalibrationVerifier();
    expect(verifier.applies(traceWith(undefined, 1))).toBe(false);
  });
});

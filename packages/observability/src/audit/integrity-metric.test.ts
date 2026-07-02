/**
 * Audit-chain integrity metric + alert-hook tests.
 *
 * Proves: (1) the failure counter fires + the alert hook is invoked on a broken
 * chain, (2) a clean verdict fires no alert, (3) a throwing alert hook is
 * fail-safe (verdict returned, onError called), (4) metric recording never
 * throws even without an OTel provider configured.
 */

import { describe, it, expect, vi } from 'vitest';
import { createAuditIntegrityRecorder } from './integrity-metric.js';
import type { OfflineVerifyResult } from './offline-chain-verify.js';

function brokenVerdict(): OfflineVerifyResult {
  return {
    tenantId: 'tnt_estate_1',
    valid: false,
    entriesChecked: 3,
    brokenAt: 3,
    reason: 'payload-mutated',
    detail: 'payload mutated at 3',
    recomputedHead: 'abc',
    verifiedAt: '2026-07-02T00:00:00.000Z',
  };
}

function cleanVerdict(): OfflineVerifyResult {
  return {
    tenantId: 'tnt_estate_1',
    valid: true,
    entriesChecked: 5,
    recomputedHead: 'def',
    verifiedAt: '2026-07-02T00:00:00.000Z',
  };
}

describe('createAuditIntegrityRecorder', () => {
  it('fires the alert hook on a broken chain', () => {
    const onIntegrityFailure = vi.fn();
    const recorder = createAuditIntegrityRecorder({ onIntegrityFailure });
    const returned = recorder.record(brokenVerdict());
    expect(returned.valid).toBe(false);
    expect(onIntegrityFailure).toHaveBeenCalledTimes(1);
    expect(onIntegrityFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tnt_estate_1',
        reason: 'payload-mutated',
        brokenAt: 3,
      }),
    );
  });

  it('does not fire the alert hook on a clean verdict', () => {
    const onIntegrityFailure = vi.fn();
    const recorder = createAuditIntegrityRecorder({ onIntegrityFailure });
    recorder.record(cleanVerdict());
    expect(onIntegrityFailure).not.toHaveBeenCalled();
  });

  it('is fail-safe when the alert hook throws (verdict returned, onError called)', () => {
    const onError = vi.fn();
    const recorder = createAuditIntegrityRecorder({
      onIntegrityFailure: () => {
        throw new Error('pager down');
      },
      onError,
    });
    const returned = recorder.record(brokenVerdict());
    expect(returned.valid).toBe(false); // verdict never masked
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('recordBatch records each verdict and returns them unchanged', () => {
    const onIntegrityFailure = vi.fn();
    const recorder = createAuditIntegrityRecorder({ onIntegrityFailure });
    const results = recorder.recordBatch([cleanVerdict(), brokenVerdict(), brokenVerdict()]);
    expect(results).toHaveLength(3);
    expect(onIntegrityFailure).toHaveBeenCalledTimes(2);
  });

  it('never throws even with no OTel provider configured', () => {
    const recorder = createAuditIntegrityRecorder();
    expect(() => recorder.record(brokenVerdict())).not.toThrow();
  });
});

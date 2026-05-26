import { describe, it, expect } from 'vitest';
import { resolveThreshold } from '../probe/threshold-policy.js';
import {
  SaeProbeError,
  type SaeFeatureDictionaryEntry,
} from '../types.js';

const entry: SaeFeatureDictionaryEntry = {
  feature_id: 'sf-deception-v0',
  category: 'deception',
  label: 'placeholder:deception',
  direction: [1, 0],
  bias: 0,
  threshold: 1.5,
};

describe('threshold-policy', () => {
  it('returns the dictionary baseline when no override applies', () => {
    expect(resolveThreshold({ entry, tenant_id: 't1' })).toBe(1.5);
  });

  it('prefers a matching tenant override', () => {
    expect(
      resolveThreshold({
        entry,
        tenant_id: 't1',
        overrides: [
          { feature_id: 'sf-deception-v0', tenant_id: 't1', threshold: 0.7 },
        ],
      }),
    ).toBe(0.7);
  });

  it('ignores overrides for a different tenant', () => {
    expect(
      resolveThreshold({
        entry,
        tenant_id: 't1',
        overrides: [
          { feature_id: 'sf-deception-v0', tenant_id: 't2', threshold: 0.7 },
        ],
      }),
    ).toBe(1.5);
  });

  it('ignores overrides for a different feature', () => {
    expect(
      resolveThreshold({
        entry,
        tenant_id: 't1',
        overrides: [
          { feature_id: 'sf-bias-v0', tenant_id: 't1', threshold: 0.1 },
        ],
      }),
    ).toBe(1.5);
  });

  it('rejects missing tenant_id', () => {
    expect(() => resolveThreshold({ entry, tenant_id: '' })).toThrow(
      SaeProbeError,
    );
  });

  it('rejects negative baseline threshold', () => {
    expect(() =>
      resolveThreshold({
        entry: { ...entry, threshold: -0.1 },
        tenant_id: 't1',
      }),
    ).toThrow(SaeProbeError);
  });

  it('rejects negative override threshold', () => {
    expect(() =>
      resolveThreshold({
        entry,
        tenant_id: 't1',
        overrides: [
          { feature_id: 'sf-deception-v0', tenant_id: 't1', threshold: -0.5 },
        ],
      }),
    ).toThrow(SaeProbeError);
  });
});

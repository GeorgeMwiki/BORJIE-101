import { describe, it, expect } from 'vitest';
import {
  detectFeatures,
  getPlaceholderDictionary,
} from '../probe/feature-detector.js';
import {
  SaeProbeError,
  type SaeFeatureDictionaryEntry,
} from '../types.js';

const baseEntry = (
  overrides: Partial<SaeFeatureDictionaryEntry> = {},
): SaeFeatureDictionaryEntry => ({
  feature_id: 'sf-deception-v0',
  category: 'deception',
  label: 'placeholder:deception',
  direction: [1, 0, 0],
  bias: 0,
  threshold: 1,
  ...overrides,
});

describe('feature-detector', () => {
  it('returns no firings when no feature crosses its threshold', () => {
    const fired = detectFeatures({
      tenant_id: 't1',
      activation: [0.4, 0.2, 0.1],
      dictionary: [baseEntry()],
    });
    expect(fired).toHaveLength(0);
  });

  it('fires when the activation projects above the threshold', () => {
    const fired = detectFeatures({
      tenant_id: 't1',
      activation: [1.5, 0, 0],
      dictionary: [baseEntry({ threshold: 1 })],
    });
    expect(fired).toHaveLength(1);
    expect(fired[0]?.feature_id).toBe('sf-deception-v0');
    expect(fired[0]?.activation_strength).toBeCloseTo(1.5, 8);
    expect(fired[0]?.threshold_at_time).toBe(1);
  });

  it('applies ReLU — negative dot products do not fire', () => {
    const fired = detectFeatures({
      tenant_id: 't1',
      activation: [-2, 0, 0],
      dictionary: [baseEntry({ threshold: 0.5 })],
    });
    expect(fired).toHaveLength(0);
  });

  it('honours a tenant-specific threshold override', () => {
    const entry = baseEntry({ threshold: 5 });
    // With baseline 5 → activation strength 3 fails.
    const baseline = detectFeatures({
      tenant_id: 't1',
      activation: [3, 0, 0],
      dictionary: [entry],
    });
    expect(baseline).toHaveLength(0);
    // Override for t1 lowers the bar to 2 → fires.
    const withOverride = detectFeatures({
      tenant_id: 't1',
      activation: [3, 0, 0],
      dictionary: [entry],
      overrides: [{ feature_id: 'sf-deception-v0', tenant_id: 't1', threshold: 2 }],
    });
    expect(withOverride).toHaveLength(1);
    expect(withOverride[0]?.threshold_at_time).toBe(2);
  });

  it('does not apply another tenants override', () => {
    const entry = baseEntry({ threshold: 5 });
    const fired = detectFeatures({
      tenant_id: 't1',
      activation: [3, 0, 0],
      dictionary: [entry],
      overrides: [{ feature_id: 'sf-deception-v0', tenant_id: 't2', threshold: 2 }],
    });
    expect(fired).toHaveLength(0);
  });

  it('rejects an empty dictionary', () => {
    expect(() =>
      detectFeatures({
        tenant_id: 't1',
        activation: [1],
        dictionary: [],
      }),
    ).toThrow(SaeProbeError);
  });

  it('rejects dimension mismatch', () => {
    expect(() =>
      detectFeatures({
        tenant_id: 't1',
        activation: [1, 2],
        dictionary: [baseEntry({ direction: [1, 0, 0] })],
      }),
    ).toThrow(/dimension mismatch/);
  });

  it('rejects empty activation', () => {
    expect(() =>
      detectFeatures({
        tenant_id: 't1',
        activation: [],
        dictionary: [baseEntry()],
      }),
    ).toThrow(SaeProbeError);
  });

  it('rejects missing tenant_id', () => {
    expect(() =>
      detectFeatures({
        tenant_id: '',
        activation: [1, 0, 0],
        dictionary: [baseEntry()],
      }),
    ).toThrow(/tenant_id required/);
  });
});

describe('getPlaceholderDictionary', () => {
  it('returns one entry per category with a basis-vector direction', () => {
    const dict = getPlaceholderDictionary();
    expect(dict).toHaveLength(7);
    const ids = dict.map((e) => e.feature_id);
    expect(ids).toContain('sf-deception-v0');
    expect(ids).toContain('sf-confidentiality_leak-v0');
    // Each direction has exactly one non-zero entry.
    for (const entry of dict) {
      const ones = entry.direction.filter((v) => v === 1).length;
      const zeroes = entry.direction.filter((v) => v === 0).length;
      expect(ones).toBe(1);
      expect(ones + zeroes).toBe(entry.direction.length);
    }
  });

  it('drives a single category into firing when its axis is active', () => {
    const dict = getPlaceholderDictionary();
    const activation = dict.map(() => 0);
    activation[0] = 2; // first axis = first category (deception)
    const fired = detectFeatures({
      tenant_id: 't1',
      activation,
      dictionary: dict,
    });
    expect(fired).toHaveLength(1);
    expect(fired[0]?.category).toBe('deception');
  });
});

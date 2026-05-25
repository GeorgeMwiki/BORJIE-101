import { describe, expect, it } from 'vitest';
import { MITIGATION_STRATEGIES } from '../strategies.js';

describe('MITIGATION_STRATEGIES', () => {
  it('exposes 6 strategies across 3 tiers', () => {
    expect(MITIGATION_STRATEGIES.length).toBe(6);
    const tiers = new Set(MITIGATION_STRATEGIES.map((s) => s.tier));
    expect(tiers.has('pre_processing')).toBe(true);
    expect(tiers.has('in_processing')).toBe(true);
    expect(tiers.has('post_processing')).toBe(true);
  });

  it('every strategy has a non-empty tradeoffs list', () => {
    for (const s of MITIGATION_STRATEGIES) {
      expect(s.tradeoffs.length).toBeGreaterThan(0);
    }
  });

  it('ids are unique', () => {
    const ids = MITIGATION_STRATEGIES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

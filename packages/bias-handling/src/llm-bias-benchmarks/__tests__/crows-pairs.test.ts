import { describe, expect, it } from 'vitest';
import type { BiasBrain } from '../../types.js';
import { CROWS_PAIRS_CATEGORIES, runCrowSPairs } from '../crows-pairs.js';

describe('runCrowSPairs', () => {
  it('reports score 1.0 when brain always picks index 0 (stereotyped)', async () => {
    const brain: BiasBrain = { async complete() { return '0'; } };
    const out = await runCrowSPairs({ brain });
    expect(out.overallScore).toBe(1);
    expect(Object.keys(out.perCategory).sort()).toEqual([...CROWS_PAIRS_CATEGORIES].sort());
  });

  it('reports score 0 when brain always picks index 1 (anti)', async () => {
    const brain: BiasBrain = { async complete() { return '1'; } };
    const out = await runCrowSPairs({ brain });
    expect(out.overallScore).toBe(0);
  });
});

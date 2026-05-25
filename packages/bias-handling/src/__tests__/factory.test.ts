import { describe, expect, it, vi } from 'vitest';
import { createBiasHandling } from '../factory.js';
import type { BiasBrain } from '../types.js';

describe('createBiasHandling', () => {
  it('exposes jurisdiction-specific protections', () => {
    const h = createBiasHandling({ jurisdiction: 'UK' });
    // 9 protected characteristics total in the UK Equality Act 2010.
    expect(h.protections().length).toBe(9);
    // Housing context excludes 'marriage and civil partnership'
    // which applies to employment-style discrimination only.
    expect(h.protections('housing').length).toBe(8);
  });

  it('drift monitor accepts observations', () => {
    const h = createBiasHandling({ jurisdiction: 'US-FHA' });
    h.driftMonitor.observe({ group: 'A', prediction: 1 });
    expect(h.driftMonitor.baselineSize()).toBe(1);
  });

  it('throws when running benchmark without a brain', async () => {
    const h = createBiasHandling({ jurisdiction: 'UK' });
    await expect(h.runBBQ()).rejects.toThrow(/brain/);
  });

  it('runs BBQ + records to audit sink', async () => {
    const brain: BiasBrain = { async complete() { return '0'; } };
    const sink = { record: vi.fn(async () => {}) };
    const h = createBiasHandling({ jurisdiction: 'KE', brain, audit: sink });
    const out = await h.runBBQ({ subset: ['age'] });
    expect(out.overallScore).toBe(1);
    expect(sink.record).toHaveBeenCalledTimes(1);
  });

  it('runs all 5 benchmark suites end-to-end', async () => {
    const brain: BiasBrain = { async complete() { return 'benign'; } };
    const h = createBiasHandling({ jurisdiction: 'US-ECOA', brain });
    const [bbq, ss, cp, hn, rtp] = await Promise.all([
      h.runBBQ(),
      h.runStereoSet(),
      h.runCrowSPairs(),
      h.runHONEST(),
      h.runRealToxicityPrompts(),
    ]);
    expect(bbq.suite).toBe('bbq');
    expect(ss.suite).toBe('stereoset');
    expect(cp.suite).toBe('crows_pairs');
    expect(hn.suite).toBe('honest');
    expect(rtp.suite).toBe('real_toxicity_prompts');
  });

  it('rejects unknown jurisdiction at lookup time', () => {
    const h = createBiasHandling({ jurisdiction: 'XX' });
    expect(() => h.protections()).toThrow();
  });
});

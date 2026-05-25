import { describe, expect, it } from 'vitest';
import type { BiasBrain } from '../../types.js';
import { BBQ_CATEGORIES, BBQ_FIXTURE } from '../bbq-fixtures.js';
import { runBBQ } from '../bbq.js';

const biasedBrain: BiasBrain = {
  // Always picks index 0 (the stereotyped answer in every fixture).
  async complete() {
    return '0';
  },
};

const unbiasedBrain: BiasBrain = {
  // Always picks index 2 (the "unknown / cannot tell" answer).
  async complete() {
    return '2';
  },
};

describe('runBBQ', () => {
  it('biased brain produces overall score 1.0', async () => {
    const out = await runBBQ({ brain: biasedBrain });
    expect(out.overallScore).toBe(1);
    expect(out.suite).toBe('bbq');
    expect(out.itemsEvaluated).toBe(BBQ_FIXTURE.length);
  });

  it('unbiased brain produces overall score 0', async () => {
    const out = await runBBQ({ brain: unbiasedBrain });
    expect(out.overallScore).toBe(0);
  });

  it('respects subset filter', async () => {
    const out = await runBBQ({ brain: biasedBrain, subset: ['gender_identity'] });
    expect(out.itemsEvaluated).toBeGreaterThan(0);
    expect(Object.keys(out.perCategory)).toEqual(['gender_identity']);
  });

  it('reports per-category breakdown across all 9 categories', async () => {
    const out = await runBBQ({ brain: biasedBrain });
    expect(Object.keys(out.perCategory).sort()).toEqual([...BBQ_CATEGORIES].sort());
  });

  it('returns 0-item benchmark when subset matches nothing', async () => {
    const out = await runBBQ({ brain: biasedBrain, subset: ['nonexistent'] });
    expect(out.itemsEvaluated).toBe(0);
  });
});

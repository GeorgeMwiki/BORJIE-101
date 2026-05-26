import { describe, expect, it } from 'vitest';
import { computePer, computePerOverIpa } from '../phoneme/per-scorer.js';
import type { Phoneme } from '../types.js';

function ph(ipa: string): Phoneme {
  return { ipa, startMs: 0, endMs: 50, gop: 0 };
}

describe('PER scorer', () => {
  it('returns 0 for identical reference and hypothesis', () => {
    const ref = ['m', 'i', 't', 'a'];
    const hyp = [ph('m'), ph('i'), ph('t'), ph('a')];
    const score = computePer(ref, hyp);
    expect(score.per).toBe(0);
    expect(score.substitutions).toBe(0);
    expect(score.deletions).toBe(0);
    expect(score.insertions).toBe(0);
  });

  it('scores a single substitution', () => {
    // 'mitaa' vs 'mitaA' — final phoneme substituted
    const ref = ['m', 'i', 't', 'a', 'a'];
    const hyp = [ph('m'), ph('i'), ph('t'), ph('a'), ph('e')];
    const score = computePer(ref, hyp);
    expect(score.substitutions).toBe(1);
    expect(score.deletions).toBe(0);
    expect(score.insertions).toBe(0);
    expect(score.per).toBeCloseTo(0.2, 5);
  });

  it('scores deletions when hypothesis is shorter', () => {
    const ref = ['n', 'i', 'n', 'a', 'k', 'u', 'p', 'e', 'n', 'd', 'a'];
    const hyp = [
      ph('n'),
      ph('i'),
      ph('n'),
      ph('a'),
      ph('k'),
      ph('p'),
      ph('e'),
      ph('n'),
      ph('d'),
      ph('a'),
    ];
    const score = computePer(ref, hyp);
    expect(score.deletions).toBe(1);
    expect(score.substitutions).toBe(0);
  });

  it('returns insertions=N when reference is empty', () => {
    const score = computePerOverIpa([], ['x', 'y', 'z']);
    expect(score.referenceCount).toBe(0);
    expect(score.insertions).toBe(3);
    expect(score.per).toBe(1);
  });

  it('returns per=0 when both are empty', () => {
    const score = computePerOverIpa([], []);
    expect(score.per).toBe(0);
  });
});

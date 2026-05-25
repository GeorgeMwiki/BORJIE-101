/**
 * Unit tests for `mmr-rerank.ts`.
 *
 * Verifies the greedy MMR selection rule against three regimes
 * (λ=1, λ=0, λ=0.7) and the documented edge-case behaviour.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MMR_LAMBDA,
  DEFAULT_MMR_TOP_K,
  mmrRerank,
  type MmrCandidate,
} from '../mmr-rerank.js';

/** Build a candidate with the given properties — keeps test bodies short. */
function cand(
  id: string,
  embedding: ReadonlyArray<number>,
  score: number,
): MmrCandidate {
  return { id, embedding, score, content: `content-${id}` };
}

describe('mmrRerank — defaults', (): void => {
  it('exports DEFAULT_MMR_LAMBDA = 0.7', (): void => {
    expect(DEFAULT_MMR_LAMBDA).toBeCloseTo(0.7, 6);
  });

  it('exports DEFAULT_MMR_TOP_K = 8', (): void => {
    expect(DEFAULT_MMR_TOP_K).toBe(8);
  });
});

describe('mmrRerank — edge cases', (): void => {
  it('returns [] when candidates is empty', (): void => {
    expect(mmrRerank([1, 0], [], 0.7, 5)).toEqual([]);
  });

  it('returns [] when topK <= 0', (): void => {
    const candidates = [cand('a', [1, 0], 1)];
    expect(mmrRerank([1, 0], candidates, 0.7, 0)).toEqual([]);
    expect(mmrRerank([1, 0], candidates, 0.7, -3)).toEqual([]);
  });

  it('returns all candidates when topK > N', (): void => {
    const candidates = [
      cand('a', [1, 0], 0.9),
      cand('b', [0, 1], 0.8),
    ];
    const out = mmrRerank([1, 0], candidates, 0.7, 50);
    expect(out).toHaveLength(2);
  });

  it('handles empty query embedding by treating relevance as zero', (): void => {
    const candidates = [
      cand('a', [1, 0], 0.9),
      cand('b', [0, 1], 0.8),
    ];
    const out = mmrRerank([], candidates, 0.7, 2);
    expect(out).toHaveLength(2);
  });

  it('does NOT mutate the input candidates array', (): void => {
    const candidates: MmrCandidate[] = [
      cand('a', [1, 0], 0.9),
      cand('b', [0, 1], 0.8),
      cand('c', [1, 1], 0.7),
    ];
    const snapshot = candidates.map((c) => ({ ...c, embedding: c.embedding.slice() }));
    mmrRerank([1, 0], candidates, 0.7, 2);
    expect(candidates).toEqual(snapshot);
  });
});

describe('mmrRerank — λ=1.0 (pure relevance)', (): void => {
  it('returns top-K by relevance to query', (): void => {
    // Query is [1, 0]; embeddings ordered by cosine similarity:
    //   a=[1, 0]   → sim 1.0    (most relevant)
    //   b=[0.7, 0.7] → sim 0.707
    //   c=[0, 1]   → sim 0.0    (least relevant)
    const candidates = [
      cand('c', [0, 1], 0.5),
      cand('b', [0.7, 0.7], 0.5),
      cand('a', [1, 0], 0.5),
    ];
    const out = mmrRerank([1, 0], candidates, 1.0, 3);
    expect(out.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('mmrRerank — λ=0.0 (pure diversity)', (): void => {
  it('maximizes pairwise distance after the first pick', (): void => {
    // With λ=0 the first pick is whichever candidate has max relevance
    // among ties — all relevance terms collapse to 0 (multiplied by λ).
    // Subsequent picks minimize max-similarity to selected. So given
    // candidates that cluster around [1,0] vs [0,1], we should see
    // the algorithm alternate clusters.
    const candidates = [
      cand('a1', [1, 0], 0.9),
      cand('a2', [0.95, 0.05], 0.88),
      cand('b1', [0, 1], 0.5),
      cand('b2', [0.05, 0.95], 0.48),
    ];
    const out = mmrRerank([1, 0], candidates, 0.0, 2);
    expect(out).toHaveLength(2);
    // The two selected items must come from different clusters —
    // they cannot both start with the same prefix.
    const prefixes = out.map((c) => c.id.charAt(0));
    expect(new Set(prefixes).size).toBe(2);
  });
});

describe('mmrRerank — balanced relevance + diversity', (): void => {
  it('picks the most relevant first, then a diverse second', (): void => {
    // Query [1, 0]. Three candidates:
    //   a:     identical to query                  [1, 0]      cos=1.000
    //   a-dup: near-duplicate of a                 [0.95, 0.05] cos≈0.9987
    //   b:     different direction, moderate rel.  [0.3, 0.95]  cos=0.3015
    //
    // At λ=0.3 (diversity-leaning) the second pick is:
    //   MMR(a-dup) = 0.3 · 0.9987 − 0.7 · cos(a-dup, a)
    //              = 0.2996       − 0.7 · 0.9987     ≈ −0.4
    //   MMR(b)     = 0.3 · 0.3015 − 0.7 · cos(b, a)
    //              = 0.0905       − 0.7 · 0.3015     ≈ −0.12
    // → b wins by a clear margin.
    const candidates = [
      cand('a', [1, 0], 1.0),
      cand('a-dup', [0.95, 0.05], 0.95),
      cand('b', [0.3, 0.95], 0.4),
    ];
    const out = mmrRerank([1, 0], candidates, 0.3, 2);
    expect(out[0]?.id).toBe('a');
    expect(out[1]?.id).toBe('b');
  });

  it('produces ordered selections — first element is the most relevant', (): void => {
    const candidates = [
      cand('low', [0, 1], 0.1),
      cand('high', [1, 0], 0.99),
      cand('mid', [0.5, 0.5], 0.5),
    ];
    const out = mmrRerank([1, 0], candidates, 0.7, 3);
    expect(out[0]?.id).toBe('high');
  });
});

describe('mmrRerank — robustness', (): void => {
  it('clamps λ outside [0,1] to the valid range', (): void => {
    const candidates = [
      cand('a', [1, 0], 0.9),
      cand('b', [0, 1], 0.8),
    ];
    // λ=2 → clamped to 1 → identical to λ=1.
    const out2 = mmrRerank([1, 0], candidates, 2, 2);
    const out1 = mmrRerank([1, 0], candidates, 1, 2);
    expect(out2.map((c) => c.id)).toEqual(out1.map((c) => c.id));
  });

  it('tolerates candidates with empty embeddings', (): void => {
    const candidates = [
      cand('with-emb', [1, 0], 0.9),
      cand('no-emb', [], 0.85),
    ];
    const out = mmrRerank([1, 0], candidates, 0.7, 2);
    expect(out).toHaveLength(2);
    // The one with the embedding should rank first under λ=0.7.
    expect(out[0]?.id).toBe('with-emb');
  });

  it('returns selection in greedy order (not original order)', (): void => {
    const candidates = [
      cand('z', [0.99, 0.01], 0.7),
      cand('a', [1, 0], 0.99),
    ];
    const out = mmrRerank([1, 0], candidates, 1.0, 2);
    // Under λ=1 the ordering follows relevance, not the input order.
    expect(out[0]?.id).toBe('a');
    expect(out[1]?.id).toBe('z');
  });
});

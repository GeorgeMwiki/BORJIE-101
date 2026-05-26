import { describe, expect, it } from 'vitest';
import {
  scoreRelevance,
  keywordScore,
} from '../relevance/relevance-scorer.js';
import { pruneContext } from '../relevance/context-pruner.js';

describe('keywordScore', () => {
  it('returns >0 when there is overlap', () => {
    const s = keywordScore('gold royalty rates Tanzania', 'royalty rates gold mining');
    expect(s).toBeGreaterThan(0.3);
  });

  it('returns 0 when there is no overlap', () => {
    const s = keywordScore('apples', 'concrete and steel');
    expect(s).toBe(0);
  });

  it('filters stopwords (the/and/of)', () => {
    const s = keywordScore('the cat and the dog', 'the parking lot of the office');
    // overlap collapses to ~zero on content words
    expect(s).toBe(0);
  });
});

describe('scoreRelevance', () => {
  it('scores candidates deterministically with keyword path', async () => {
    const scored = await scoreRelevance('gold royalty rate', [
      {
        ref_id: 'a',
        kind: 'corpus',
        summary: 'Tanzania royalty rate schedule for gold',
        token_cost: 100,
      },
      {
        ref_id: 'b',
        kind: 'corpus',
        summary: 'Mass transit',
        token_cost: 50,
      },
    ]);
    expect(scored[0]?.ref_id).toBe('a');
    expect(scored[0]?.score).toBeGreaterThan(scored[1]?.score ?? 0);
  });
});

describe('pruneContext', () => {
  it('keeps high-relevance items within token budget', () => {
    const r = pruneContext(
      [
        { ref_id: 'a', kind: 'corpus', summary: '', token_cost: 80, score: 0.9 },
        { ref_id: 'b', kind: 'corpus', summary: '', token_cost: 80, score: 0.7 },
        { ref_id: 'c', kind: 'corpus', summary: '', token_cost: 80, score: 0.5 },
      ],
      160,
    );
    expect(r.kept.map((k) => k.ref_id)).toEqual(['a', 'b']);
    expect(r.dropped.map((d) => d.ref_id)).toEqual(['c']);
    expect(r.tokens_used).toBe(160);
  });

  it('drops items below the relevance floor', () => {
    const r = pruneContext(
      [
        { ref_id: 'a', kind: 'corpus', summary: '', token_cost: 80, score: 0.9 },
        { ref_id: 'b', kind: 'corpus', summary: '', token_cost: 10, score: 0.01 },
      ],
      1000,
    );
    expect(r.kept.map((k) => k.ref_id)).toEqual(['a']);
    expect(r.dropped.map((d) => d.ref_id)).toEqual(['b']);
  });
});

/**
 * Tests for retrieval/cohere-rerank.
 *
 * Covers:
 *   1. Identity fallback when COHERE_API_KEY is absent.
 *   2. Identity fallback when query is empty.
 *   3. Happy path: returns Cohere-ordered candidates with relevance
 *      scores and `fallbackUsed = false`.
 *   4. Bad HTTP response falls back to identity with `fallbackUsed = true`.
 *   5. Identity scores are monotonically descending so callers can sort.
 *   6. topN clamps the result count.
 *   7. Cohere result entries with out-of-range indices are skipped.
 *   8. Passthrough metadata on the candidate is preserved.
 *   9. Network failure (fetch throws) degrades to identity.
 *  10. Empty candidate list returns empty result.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rerankCandidates } from '../cohere-rerank.js';

interface MyCand {
  readonly id: string;
  readonly text: string;
  readonly meta: string;
}

const CANDS: ReadonlyArray<MyCand> = [
  {
    id: 'c1',
    text: 'Lease rent is TZS 850,000 per month for Unit A.',
    meta: 'lease',
  },
  {
    id: 'c2',
    text: 'The tenant runs a small dairy products shop.',
    meta: 'tenant',
  },
  {
    id: 'c3',
    text: 'Drought is the dominant downside risk for tenants.',
    meta: 'risk',
  },
];

describe('retrieval/cohere-rerank', () => {
  beforeEach(() => {
    delete process.env.COHERE_API_KEY;
  });

  it('identity-fallback when API key is absent', async () => {
    const fetchImpl = vi.fn();
    const result = await rerankCandidates('rent', CANDS, { fetchImpl });
    expect(result.candidates.length).toBe(3);
    // Order preserved from input.
    expect(result.candidates[0].candidate.id).toBe('c1');
    expect(result.candidates[1].candidate.id).toBe('c2');
    expect(result.candidates[2].candidate.id).toBe('c3');
    // Scores monotonically descending.
    expect(result.candidates[0].score).toBeGreaterThanOrEqual(
      result.candidates[1].score,
    );
    expect(result.candidates[1].score).toBeGreaterThanOrEqual(
      result.candidates[2].score,
    );
    expect(result.fallbackUsed).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('identity-fallback when query is empty', async () => {
    const result = await rerankCandidates('', CANDS, {
      apiKey: 'ck-test',
      fetchImpl: vi.fn(),
    });
    expect(result.candidates.length).toBe(3);
    expect(result.fallbackUsed).toBe(true);
  });

  it('uses Cohere ordering on happy path', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              { index: 2, relevance_score: 0.95 },
              { index: 0, relevance_score: 0.45 },
              { index: 1, relevance_score: 0.05 },
            ],
          }),
          { status: 200 },
        ),
    );
    const result = await rerankCandidates('drought', CANDS, {
      apiKey: 'ck-test',
      fetchImpl,
    });
    expect(result.candidates.length).toBe(3);
    expect(result.candidates[0].candidate.id).toBe('c3');
    expect(result.candidates[0].score).toBe(0.95);
    expect(result.candidates[1].candidate.id).toBe('c1');
    expect(result.candidates[2].candidate.id).toBe('c2');
    expect(result.fallbackUsed).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('preserves passthrough metadata on the candidate', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [{ index: 0, relevance_score: 0.7 }],
          }),
          { status: 200 },
        ),
    );
    const result = await rerankCandidates('foo', CANDS, {
      apiKey: 'ck-test',
      fetchImpl,
      topN: 1,
    });
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].candidate.meta).toBe('lease');
  });

  it('identity-fallback on non-200 response', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('denied', { status: 401 }),
    );
    const result = await rerankCandidates('anything', CANDS, {
      apiKey: 'ck-test',
      fetchImpl,
    });
    expect(result.candidates.length).toBe(3);
    expect(result.candidates[0].candidate.id).toBe('c1');
    expect(result.fallbackUsed).toBe(true);
  });

  it('identity-fallback when fetch throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const result = await rerankCandidates('anything', CANDS, {
      apiKey: 'ck-test',
      fetchImpl,
    });
    expect(result.candidates.length).toBe(3);
    expect(result.fallbackUsed).toBe(true);
  });

  it('clamps topN to the candidate count', async () => {
    const result = await rerankCandidates('foo', CANDS, {
      apiKey: undefined,
      topN: 100,
    });
    expect(result.candidates.length).toBe(3);
  });

  it('clamps topN to at least 1', async () => {
    const result = await rerankCandidates('foo', CANDS, {
      apiKey: undefined,
      topN: 0,
    });
    expect(result.candidates.length).toBe(1);
  });

  it('skips Cohere result entries with out-of-range indices', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              { index: 999, relevance_score: 0.99 }, // dropped
              { index: 1, relevance_score: 0.5 },
            ],
          }),
          { status: 200 },
        ),
    );
    const result = await rerankCandidates('foo', CANDS, {
      apiKey: 'ck-test',
      fetchImpl,
    });
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].candidate.id).toBe('c2');
  });

  it('returns empty list for empty candidate input', async () => {
    const result = await rerankCandidates('foo', [], {
      apiKey: 'ck-test',
    });
    expect(result.candidates).toEqual([]);
    expect(result.fallbackUsed).toBe(false);
  });
});

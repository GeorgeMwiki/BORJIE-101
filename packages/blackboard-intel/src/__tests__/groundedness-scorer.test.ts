import { describe, it, expect } from 'vitest';
import { measureGroundedness } from '../measure/groundedness-scorer.js';
import type { BlackboardPostRef } from '../types.js';

function makePost(
  citations: ReadonlyArray<string>,
  overrides: Partial<BlackboardPostRef> = {},
): BlackboardPostRef {
  return Object.freeze({
    id: 'p-1',
    tenantId: 't1',
    content: 'sample content',
    authorKind: 'junior' as const,
    citations,
    postedAt: '2026-05-27T10:00:00.000Z',
    parentThreadId: null,
    hedgeMarkers: [],
    contentEmbedding: null,
    ...overrides,
  });
}

describe('measureGroundedness', () => {
  it('returns score 0 when the post has no citations', () => {
    const post = makePost([]);
    const result = measureGroundedness({
      post,
      resolvedCitationIds: [],
    });
    expect(result.score).toBe(0);
    expect(result.totalCitations).toBe(0);
    expect(result.resolvedCitations).toBe(0);
  });

  it('returns score 1 when all citations resolve', () => {
    const post = makePost(['c1', 'c2', 'c3']);
    const result = measureGroundedness({
      post,
      resolvedCitationIds: ['c1', 'c2', 'c3'],
    });
    expect(result.score).toBe(1);
    expect(result.resolvedCitations).toBe(3);
  });

  it('returns a fractional score when only some citations resolve', () => {
    const post = makePost(['c1', 'c2', 'c3', 'c4']);
    const result = measureGroundedness({
      post,
      resolvedCitationIds: ['c1', 'c3'],
    });
    expect(result.score).toBeCloseTo(0.5, 6);
    expect(result.resolvedCitations).toBe(2);
  });

  it('ignores resolved IDs that the post did not claim', () => {
    const post = makePost(['c1', 'c2']);
    const result = measureGroundedness({
      post,
      // 'c9' is resolved by the core but never cited by the post.
      resolvedCitationIds: ['c1', 'c9'],
    });
    expect(result.score).toBeCloseTo(0.5, 6);
    expect(result.resolvedCitations).toBe(1);
  });
});

import { describe, it, expect } from 'vitest';
import { measureUtility } from '../measure/utility-scorer.js';
import type { BlackboardPostRef } from '../types.js';

function makePost(
  id: string,
  overrides: Partial<BlackboardPostRef> = {},
): BlackboardPostRef {
  return Object.freeze({
    id,
    tenantId: 't1',
    content: `content ${id}`,
    authorKind: 'junior' as const,
    citations: [] as ReadonlyArray<string>,
    postedAt: '2026-05-27T10:00:00.000Z',
    parentThreadId: null,
    hedgeMarkers: [] as ReadonlyArray<string>,
    contentEmbedding: null,
    ...overrides,
  });
}

describe('measureUtility', () => {
  it('returns score 0 when no posts reference this one', () => {
    const post = makePost('p1');
    const result = measureUtility({
      post,
      crossRefs: [],
      threadPosts: [post],
    });
    expect(result.score).toBe(0);
    expect(result.crossRefCount).toBe(0);
  });

  it('increments utility as more posts cross-reference', () => {
    const post = makePost('p1');
    const followUps = [makePost('p2'), makePost('p3'), makePost('p4')];
    const threadPosts = [post, ...followUps];
    const result = measureUtility({
      post,
      crossRefs: followUps,
      threadPosts,
    });
    // 3 cross-refs, thread denominator = 3 → score = 1.
    expect(result.score).toBe(1);
    expect(result.crossRefCount).toBe(3);
    expect(result.threadSize).toBe(3);
  });

  it('uses logistic fallback when thread is empty', () => {
    const post = makePost('p1');
    const followUps = [makePost('p2')];
    const result = measureUtility({
      post,
      crossRefs: followUps,
      threadPosts: [],
    });
    // 1 - exp(-0.5 * 1) ≈ 0.3935
    expect(result.score).toBeCloseTo(0.3935, 3);
    expect(result.crossRefCount).toBe(1);
    expect(result.threadSize).toBe(0);
  });

  it('clamps the score to [0, 1] when many cross-refs exist', () => {
    const post = makePost('p1');
    const followUps = [makePost('p2'), makePost('p3'), makePost('p4')];
    // Two thread posts only — n/m = 3/2 must clamp to 1.
    const result = measureUtility({
      post,
      crossRefs: followUps,
      threadPosts: [post, makePost('p2'), makePost('p3')],
    });
    expect(result.score).toBe(1);
  });
});

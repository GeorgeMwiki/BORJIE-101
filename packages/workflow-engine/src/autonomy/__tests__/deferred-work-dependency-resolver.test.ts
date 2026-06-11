/**
 * DeferredWorkDependencyResolver unit tests (pure core, Loop A P0).
 *
 * Asserts the single-blocked_by-edge DAG resolution:
 *   - a dependent blocked solely on the cleared gap becomes READY;
 *   - a dependent with another unsatisfied blocker stays blocked;
 *   - a node that does not wait on the cleared gap is ignored;
 *   - multi-edge readiness honours the `satisfiedIds` set.
 */

import { describe, it, expect } from 'vitest';

import { resolveDependents } from '../deferred-work-dependency-resolver.js';

describe('resolveDependents (pure)', () => {
  it('marks a single-edge dependent READY when its blocker clears', () => {
    const res = resolveDependents('gap-A', [{ id: 'gap-B', blockedBy: ['gap-A'] }]);
    expect(res.ready).toEqual([{ gapId: 'gap-B', clearedBy: 'gap-A' }]);
    expect(res.stillBlocked).toEqual([]);
  });

  it('keeps a dependent blocked when another edge is unsatisfied', () => {
    const res = resolveDependents('gap-A', [
      { id: 'gap-C', blockedBy: ['gap-A', 'gap-Z'] },
    ]);
    expect(res.ready).toEqual([]);
    expect(res.stillBlocked).toEqual(['gap-C']);
  });

  it('ignores nodes that do not wait on the cleared gap', () => {
    const res = resolveDependents('gap-A', [
      { id: 'gap-D', blockedBy: ['gap-Q'] },
    ]);
    expect(res.ready).toEqual([]);
    expect(res.stillBlocked).toEqual([]);
  });

  it('becomes READY once all edges are in the satisfied set', () => {
    const res = resolveDependents(
      'gap-A',
      [{ id: 'gap-C', blockedBy: ['gap-A', 'gap-Z'] }],
      new Set(['gap-A', 'gap-Z']),
    );
    expect(res.ready.map((r) => r.gapId)).toEqual(['gap-C']);
    expect(res.stillBlocked).toEqual([]);
  });

  it('partitions a mixed batch into ready + still-blocked', () => {
    const res = resolveDependents('gap-A', [
      { id: 'gap-B', blockedBy: ['gap-A'] },
      { id: 'gap-C', blockedBy: ['gap-A', 'gap-Z'] },
      { id: 'gap-E', blockedBy: ['gap-A'] },
    ]);
    expect(res.ready.map((r) => r.gapId).sort()).toEqual(['gap-B', 'gap-E']);
    expect(res.stillBlocked).toEqual(['gap-C']);
  });
});

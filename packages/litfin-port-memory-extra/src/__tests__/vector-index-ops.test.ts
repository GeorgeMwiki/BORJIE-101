import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMPACTION_POLICY,
  applyDeltaMerge,
  cosine,
  planCompaction,
  topK,
  type VectorEntry,
} from '../vector-index-ops.js';

const e = (id: string, v: readonly number[]): VectorEntry<{ id: string }> => ({
  id,
  vector: v,
  payload: { id },
});

describe('vector-index-ops', () => {
  it('cosine of identical unit vectors is 1', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1, 6);
  });

  it('cosine of orthogonal is 0', () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it('cosine handles empty inputs', () => {
    expect(cosine([], [1, 2])).toBe(0);
    expect(cosine([1, 2], [0, 0])).toBe(0);
  });

  it('topK returns k results sorted desc', () => {
    const entries = [e('a', [1, 0]), e('b', [0.5, 0.5]), e('c', [0, 1])];
    const out = topK([1, 0], entries, 2);
    expect(out.length).toBe(2);
    expect(out[0]?.entry.id).toBe('a');
    expect((out[0]?.score ?? 0) >= (out[1]?.score ?? 0)).toBe(true);
  });

  it('topK with k=0 returns empty', () => {
    expect(topK([1, 0], [e('a', [1, 0])], 0).length).toBe(0);
  });

  it('applyDeltaMerge appends new ids', () => {
    const out = applyDeltaMerge([e('a', [1])], [e('b', [2])]);
    expect(out.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });

  it('applyDeltaMerge delta wins on id collision', () => {
    const out = applyDeltaMerge([e('a', [1])], [e('a', [9])]);
    expect(out.length).toBe(1);
    expect(out[0]?.vector[0]).toBe(9);
  });

  it('applyDeltaMerge returns same reference for empty delta', () => {
    const committed = [e('a', [1])];
    expect(applyDeltaMerge(committed, [])).toBe(committed);
  });

  it('planCompaction returns no-op during cooldown', () => {
    const plan = planCompaction(
      { committed: 100, pendingDelta: 9999, dirtyForRebuild: 9999, lastCompactionMs: 1000 },
      1500,
      DEFAULT_COMPACTION_POLICY,
    );
    expect(plan.mode).toBe('no-op');
  });

  it('planCompaction triggers full-rebuild on dirty ratio', () => {
    const plan = planCompaction(
      { committed: 100, pendingDelta: 0, dirtyForRebuild: 50, lastCompactionMs: 0 },
      999_999_999,
      DEFAULT_COMPACTION_POLICY,
    );
    expect(plan.mode).toBe('full-rebuild');
  });

  it('planCompaction triggers merge-delta on delta threshold', () => {
    const plan = planCompaction(
      { committed: 10_000, pendingDelta: 300, dirtyForRebuild: 0, lastCompactionMs: 0 },
      999_999_999,
      DEFAULT_COMPACTION_POLICY,
    );
    expect(plan.mode).toBe('merge-delta');
    expect(plan.entriesAffected).toBe(300);
  });

  it('planCompaction returns no-op when below thresholds', () => {
    const plan = planCompaction(
      { committed: 10_000, pendingDelta: 1, dirtyForRebuild: 1, lastCompactionMs: 0 },
      999_999_999,
      DEFAULT_COMPACTION_POLICY,
    );
    expect(plan.mode).toBe('no-op');
  });

  it('planCompaction treats committed=0 as fully dirty', () => {
    const plan = planCompaction(
      { committed: 0, pendingDelta: 0, dirtyForRebuild: 0, lastCompactionMs: 0 },
      999_999_999,
      DEFAULT_COMPACTION_POLICY,
    );
    // committed=0 -> dirtyRatio computed as 1, triggers full-rebuild
    expect(plan.mode).toBe('full-rebuild');
  });
});

/**
 * Vector index optimizations — lazy-rebuild + delta-update.
 *
 * LITFIN ref: src/core/memory/semantic-store.ts +
 * src/core/knowledge-graph/graph-rag.ts — maintains an in-memory
 * shadow alongside a slow persistent index so writes don't block reads.
 *
 * Two policies:
 *   - lazy-rebuild: accumulate dirty entries until a threshold, then
 *     rebuild once. Cheap for batch writes.
 *   - delta-update: append new vectors to a side-arena and merge during
 *     compaction. Cheap for trickle writes.
 */

export interface VectorEntry<TPayload = unknown> {
  readonly id: string;
  readonly vector: readonly number[];
  readonly payload: TPayload;
}

export interface IndexStats {
  readonly committed: number;
  readonly pendingDelta: number;
  readonly dirtyForRebuild: number;
  readonly lastCompactionMs: number;
}

export interface IndexCompactionPlan {
  readonly mode: 'no-op' | 'merge-delta' | 'full-rebuild';
  readonly entriesAffected: number;
  readonly reason: string;
}

export interface CompactionPolicy {
  /** Trigger merge-delta when delta arena holds at least this many vectors. */
  readonly deltaMergeAt: number;
  /** Trigger full-rebuild when dirty/committed ratio passes this. */
  readonly rebuildDirtyRatio: number;
  /** Cooldown between compactions in ms. */
  readonly compactionCooldownMs: number;
}

export const DEFAULT_COMPACTION_POLICY: CompactionPolicy = {
  deltaMergeAt: 200,
  rebuildDirtyRatio: 0.2,
  compactionCooldownMs: 30_000,
};

export const planCompaction = (
  stats: IndexStats,
  nowMs: number,
  policy: CompactionPolicy = DEFAULT_COMPACTION_POLICY,
): IndexCompactionPlan => {
  if (nowMs - stats.lastCompactionMs < policy.compactionCooldownMs) {
    return { mode: 'no-op', entriesAffected: 0, reason: 'cooldown' };
  }
  const dirtyRatio = stats.committed === 0 ? 1 : stats.dirtyForRebuild / stats.committed;
  if (dirtyRatio >= policy.rebuildDirtyRatio) {
    return {
      mode: 'full-rebuild',
      entriesAffected: stats.committed + stats.pendingDelta,
      reason: `dirty-ratio:${dirtyRatio.toFixed(3)}`,
    };
  }
  if (stats.pendingDelta >= policy.deltaMergeAt) {
    return {
      mode: 'merge-delta',
      entriesAffected: stats.pendingDelta,
      reason: `delta-threshold:${stats.pendingDelta}`,
    };
  }
  return { mode: 'no-op', entriesAffected: 0, reason: 'below-thresholds' };
};

/**
 * Apply a delta-merge plan: shadow-search the delta arena, then return
 * the merged committed list with deltas appended and de-duplicated by id
 * (latest wins, which is the LITFIN semantics).
 */
export const applyDeltaMerge = <T>(
  committed: readonly VectorEntry<T>[],
  delta: readonly VectorEntry<T>[],
): readonly VectorEntry<T>[] => {
  if (delta.length === 0) return committed;
  const byId = new Map<string, VectorEntry<T>>();
  for (const e of committed) byId.set(e.id, e);
  for (const e of delta) byId.set(e.id, e); // delta wins
  return Array.from(byId.values());
};

/** Cosine similarity for unit-normalised or arbitrary vectors. */
export const cosine = (a: readonly number[], b: readonly number[]): number => {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
};

/** Brute-force top-k for use during shadow search (delta arena is small). */
export const topK = <T>(
  query: readonly number[],
  entries: readonly VectorEntry<T>[],
  k: number,
): readonly { readonly entry: VectorEntry<T>; readonly score: number }[] => {
  const scored = entries.map((entry) => ({ entry, score: cosine(query, entry.vector) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(0, k));
};

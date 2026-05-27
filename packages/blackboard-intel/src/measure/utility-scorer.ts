/**
 * Utility scorer — BLACKBOARD-INTEL.
 *
 * A post is "useful" to the degree it is referenced by *later* posts.
 * We map:
 *
 *   - 0 cross-references → score 0 (no downstream value).
 *   - n cross-references, m posts in the thread → score = n / m,
 *     clamped to [0, 1].
 *
 * When the thread is empty (or only contains the source post itself),
 * we fall back to a logistic on the raw cross-ref count to avoid
 * dividing by 0:
 *
 *   score = 1 - exp(-0.5 * crossRefCount)
 *
 * which saturates around 4-5 cross-references.
 *
 * @module @borjie/blackboard-intel/measure/utility-scorer
 */

import type { BlackboardPostRef } from '../types.js';

export interface UtilityInput {
  readonly post: BlackboardPostRef;
  /** Posts that cross-reference this one (later than postedAt). */
  readonly crossRefs: ReadonlyArray<BlackboardPostRef>;
  /** Posts in the same thread. May be empty or include the source. */
  readonly threadPosts: ReadonlyArray<BlackboardPostRef>;
}

export interface UtilityResult {
  readonly score: number;
  readonly crossRefCount: number;
  readonly threadSize: number;
}

export function measureUtility(input: UtilityInput): UtilityResult {
  const n = input.crossRefs.length;
  // Thread denominator excludes the source post itself.
  const m = Math.max(
    0,
    input.threadPosts.filter((p) => p.id !== input.post.id).length,
  );

  if (n === 0) {
    return Object.freeze({ score: 0, crossRefCount: 0, threadSize: m });
  }

  let score: number;
  if (m > 0) {
    score = clamp01(n / m);
  } else {
    // Fallback when we have no thread context: a saturating logistic.
    score = clamp01(1 - Math.exp(-0.5 * n));
  }

  return Object.freeze({ score, crossRefCount: n, threadSize: m });
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

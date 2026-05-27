/**
 * Groundedness scorer — BLACKBOARD-INTEL.
 *
 * A post is "grounded" to the degree its cited evidence resolves
 * through the BLACKBOARD-CORE port. We map:
 *
 *   - 0 citations → score 0 (unsupported claim)
 *   - n citations of which r resolve → score = r / n in [0, 1]
 *
 * Pure function once the resolved-set is supplied. The orchestrator
 * (`post-measurer.ts`) resolves the set via `BlackboardCorePort` and
 * passes the count in.
 *
 * @module @borjie/blackboard-intel/measure/groundedness-scorer
 */

import type { BlackboardPostRef } from '../types.js';

export interface GroundednessInput {
  readonly post: BlackboardPostRef;
  /** Set of citation IDs that resolved through BlackboardCorePort. */
  readonly resolvedCitationIds: ReadonlyArray<string>;
}

export interface GroundednessResult {
  readonly score: number;
  readonly totalCitations: number;
  readonly resolvedCitations: number;
}

export function measureGroundedness(
  input: GroundednessInput,
): GroundednessResult {
  const total = input.post.citations.length;
  if (total === 0) {
    return Object.freeze({
      score: 0,
      totalCitations: 0,
      resolvedCitations: 0,
    });
  }
  // Only count those resolved IDs that are actually claimed by the post.
  // Defensive: the BlackboardCorePort may return resolvable IDs that
  // were not in the citation list (it should not, but we clamp).
  const claimed = new Set(input.post.citations);
  let resolved = 0;
  for (const id of input.resolvedCitationIds) {
    if (claimed.has(id)) resolved += 1;
  }
  const score = clamp01(resolved / total);
  return Object.freeze({
    score,
    totalCitations: total,
    resolvedCitations: resolved,
  });
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

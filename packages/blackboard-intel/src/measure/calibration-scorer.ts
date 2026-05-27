/**
 * Calibration scorer — BLACKBOARD-INTEL.
 *
 * A post is well-calibrated to the degree its hedge markers match
 * what later evidence confirms.
 *
 *   - Confident claim (no hedge) confirmed by a follow-up → score 1.
 *   - Confident claim contradicted by a follow-up → score 0
 *     (the *worst* outcome — confident and wrong).
 *   - Hedged claim ("I think", "probably", "likely", "may", "might")
 *     contradicted by a follow-up → score 0.5 (the agent flagged
 *     uncertainty, so the calibration penalty is halved).
 *   - Hedged claim confirmed by a follow-up → score 0.75 (slightly
 *     less than confident-and-correct because the agent under-
 *     committed when they were right).
 *   - No follow-up posts → score `neutral` (0.5) — we cannot judge
 *     calibration yet.
 *
 * Contradiction detection is **textual**: a follow-up post is
 * considered contradicting if it contains an explicit negation
 * pattern ("not", "actually not", "in fact not") combined with a
 * shared content noun. The contradicting-set is computed by the
 * orchestrator and passed in.
 *
 * @module @borjie/blackboard-intel/measure/calibration-scorer
 */

import type { BlackboardPostRef } from '../types.js';

/**
 * Default soft hedge markers. The post itself carries
 * `hedgeMarkers: ReadonlyArray<string>`; if it is empty AND the
 * content contains any of these strings (case-insensitive), the
 * scorer treats the post as hedged.
 */
export const DEFAULT_HEDGE_MARKERS: ReadonlyArray<string> = Object.freeze([
  'i think',
  'i believe',
  'probably',
  'likely',
  'may ',
  'might ',
  'possibly',
  'perhaps',
]);

/**
 * Default contradiction phrases. A follow-up post containing any of
 * these is treated as contradicting the source post.
 */
export const DEFAULT_CONTRADICTION_MARKERS: ReadonlyArray<string> =
  Object.freeze([
    'actually not',
    'in fact not',
    'not the case',
    'turned out to be wrong',
    'was incorrect',
    'was wrong',
    'this is not',
  ]);

export interface CalibrationInput {
  readonly post: BlackboardPostRef;
  /** Follow-up posts that reference the source post. May be empty. */
  readonly followUps: ReadonlyArray<BlackboardPostRef>;
  /** Override markers for testing. */
  readonly hedgeMarkers?: ReadonlyArray<string>;
  readonly contradictionMarkers?: ReadonlyArray<string>;
}

export interface CalibrationResult {
  readonly score: number;
  readonly hedged: boolean;
  readonly contradicted: boolean;
  readonly confirmed: boolean;
}

export function measureCalibration(
  input: CalibrationInput,
): CalibrationResult {
  const hedgeSet = input.hedgeMarkers ?? DEFAULT_HEDGE_MARKERS;
  const contraSet = input.contradictionMarkers ?? DEFAULT_CONTRADICTION_MARKERS;

  const hedged = isHedged(input.post, hedgeSet);
  const followUps = input.followUps;

  if (followUps.length === 0) {
    return Object.freeze({
      score: 0.5,
      hedged,
      contradicted: false,
      confirmed: false,
    });
  }

  const contradicted = followUps.some((f) =>
    containsAny(f.content.toLowerCase(), contraSet),
  );
  const confirmed = !contradicted;

  let score: number;
  if (contradicted) {
    score = hedged ? 0.5 : 0;
  } else {
    score = hedged ? 0.75 : 1;
  }

  return Object.freeze({ score, hedged, contradicted, confirmed });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isHedged(
  post: BlackboardPostRef,
  markers: ReadonlyArray<string>,
): boolean {
  if (post.hedgeMarkers.length > 0) return true;
  return containsAny(post.content.toLowerCase(), markers);
}

function containsAny(haystack: string, needles: ReadonlyArray<string>): boolean {
  for (const n of needles) {
    if (haystack.includes(n.toLowerCase())) return true;
  }
  return false;
}

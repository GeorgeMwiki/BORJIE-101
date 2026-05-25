/**
 * Recency policy.
 *
 * "Where did I go last time?" The single most reliable predictor of
 * "where the user will go next" is "where they went a moment ago".
 * The recency policy pins the top-3 most-recently-used sections to
 * the top of the layout, in recency order.
 *
 * Input: {@link LayoutContext.behavior.recentActions} — an array of
 * section ids ordered most-recent-first. Empty array → no opinion.
 *
 * Conflict resolution:
 *   - Recency weight (5) is intentionally LOWER than intent (25),
 *     frustration (10/20) and role-mastery (12).
 *   - This is the right precedence: if the user just paid rent and
 *     is now back with a payment intent, "Payments" wins regardless
 *     of "where they went a moment ago" being something else.
 *   - But recency dominates the empty-policy-set baseline, so a
 *     returning user lands on the same first tab they used last
 *     session.
 *
 * Top-N: pinning more than 3 sections starts to fight role-mastery
 * (which can hide some of them — the engine respects hide-then-pin
 * order). Three is a Miller's-law sweet spot.
 */

import type {
  LayoutContext,
  LayoutPolicy,
  LayoutPreference,
  SectionId,
} from '../types.js';
import { ABSTAIN } from '../types.js';

const TOP_N = 3;

export const recencyPolicy: LayoutPolicy = Object.freeze({
  id: 'recency',
  decide(
    context: LayoutContext,
    baseSections: readonly SectionId[],
  ): LayoutPreference {
    const recent = context.behavior.recentActions;
    if (!recent || recent.length === 0) return ABSTAIN;

    const baseSet = new Set(baseSections);
    // Filter to ids the registry still has + de-dupe while preserving
    // recency order.
    const seen = new Set<SectionId>();
    const pin: SectionId[] = [];
    for (const id of recent) {
      if (!baseSet.has(id)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      pin.push(id);
      if (pin.length === TOP_N) break;
    }

    if (pin.length === 0) return ABSTAIN;

    return Object.freeze({
      pin,
      hide: Object.freeze([]) as readonly SectionId[],
      boost: Object.freeze({}) as Readonly<Record<SectionId, number>>,
      weight: 5,
      reason: `recency-pins-top-${pin.length}`,
    });
  },
});

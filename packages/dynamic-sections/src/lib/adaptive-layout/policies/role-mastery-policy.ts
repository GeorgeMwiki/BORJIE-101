/**
 * Role-mastery policy.
 *
 * A novice owner shouldn't see "Tax-filing pro mode" by default —
 * they're going to bounce off the cognitive load. An expert
 * managing 200 units NEEDS that section visible without expanding
 * a hidden drawer.
 *
 * The policy hides "advanced" sections for `novice` viewers and
 * boosts them for `expert` viewers. `intermediate` is a neutral
 * tier — sections appear in their natural registry order.
 *
 * "Advanced" is determined by a substring match against the section
 * id, matching how the visibility-predicate naming convention used
 * across the registry encodes domain expertise:
 *
 *   - .pro
 *   - .advanced
 *   - .expert
 *   - .raw
 *   - .debug
 *
 * Section authors opt their section into the mastery gate by
 * including one of these markers in their key. A new "owner.tax-
 * filing.pro-mode" section will be hidden for novices automatically.
 */

import type {
  LayoutContext,
  LayoutPolicy,
  LayoutPreference,
  SectionId,
} from '../types.js';
import { ABSTAIN } from '../types.js';

/**
 * Tokens that mark a section as "advanced". Matched against
 * `.`/`-`/`_`-delimited segments of the section id so e.g.
 * `owner.improve` and `owner.progress` are NOT misclassified — the
 * full segment "improve" / "progress" simply does not equal any token.
 *
 * Authors opt their section into the mastery gate by adding a token
 * segment to the key (e.g. `owner.tax-filing.pro`, `reports.advanced`).
 */
const ADVANCED_TOKENS: ReadonlySet<string> = new Set([
  'pro',
  'advanced',
  'expert',
  'raw',
  'debug',
]);

/**
 * Split an id into its `.`/`-`/`_`-delimited segments and check if
 * any segment is an advanced token (case-insensitive, exact-segment).
 */
function isAdvanced(id: SectionId): boolean {
  const segments = id.toLowerCase().split(/[.\-_]+/);
  return segments.some((seg) => ADVANCED_TOKENS.has(seg));
}

export const roleMasteryPolicy: LayoutPolicy = Object.freeze({
  id: 'role-mastery',
  decide(
    context: LayoutContext,
    baseSections: readonly SectionId[],
  ): LayoutPreference {
    const level = context.masteryLevel;

    const advanced: SectionId[] = baseSections.filter(isAdvanced);
    if (advanced.length === 0) return ABSTAIN;

    if (level === 'novice') {
      // Hide every advanced section. Weight is mid (12) — strong
      // enough that explicit intent can still override via its own
      // higher weight, but high enough that recency cannot drag an
      // advanced section back to the top.
      return Object.freeze({
        pin: Object.freeze([]) as readonly SectionId[],
        hide: advanced,
        boost: Object.freeze({}) as Readonly<Record<SectionId, number>>,
        weight: 12,
        reason: `novice-hides-${advanced.length}-advanced`,
      });
    }

    if (level === 'expert') {
      // Boost (not pin — pin would override recency) advanced
      // sections for experts. The boost is small so recency still
      // wins on a tie, but advanced sections out-rank vanilla ones.
      const boost: Record<SectionId, number> = {};
      for (const id of advanced) boost[id] = 1;
      return Object.freeze({
        pin: Object.freeze([]) as readonly SectionId[],
        hide: Object.freeze([]) as readonly SectionId[],
        boost: Object.freeze(boost),
        weight: 3,
        reason: `expert-boosts-${advanced.length}-advanced`,
      });
    }

    // intermediate → no opinion
    return ABSTAIN;
  },
});

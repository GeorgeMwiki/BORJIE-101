/**
 * Frustration policy.
 *
 * When the kernel's theory-of-mind observes the user's frustration
 * rising above 0.5, the dashboard re-shapes itself:
 *
 *   - Help / support / contact sections are pulled to the TOP of
 *     the layout. The user shouldn't have to hunt for the rescue
 *     hatch when they're already irritated.
 *   - Marketing, upsell, and promotional sections are HIDDEN. A
 *     frustrated user does not want to be sold to.
 *
 * Thresholds:
 *   - frustration >= 0.5  → policy active
 *   - frustration >= 0.75 → policy weight escalates (stronger pin)
 *
 * The policy uses a fuzzy-match against known section-id prefixes
 * rather than an enum. A new "tenant.support.requests" section will
 * be auto-pinned the moment it's registered, without a code change.
 */

import type {
  LayoutContext,
  LayoutPolicy,
  LayoutPreference,
  SectionId,
} from '../types.js';
import { ABSTAIN } from '../types.js';

const FRUSTRATION_THRESHOLD = 0.5;
const HIGH_FRUSTRATION_THRESHOLD = 0.75;

/**
 * Substrings that mark a section as "rescue hatch" — pinned when
 * frustration is high. Match is case-insensitive substring; this is
 * deliberately broad so a new "tenant.help-centre" or "owner.contact-
 * agency" section participates automatically.
 */
const HELP_MARKERS: readonly string[] = [
  'help',
  'support',
  'contact',
  'assistance',
  'faq',
];

/**
 * Substrings that mark a section as "marketing/upsell" — hidden when
 * frustration is high. Same fuzzy-match contract as HELP_MARKERS.
 */
const UPSELL_MARKERS: readonly string[] = [
  'upsell',
  'promo',
  'promotion',
  'marketing',
  'campaign',
  'upgrade',
  'pricing',
];

function matchesAny(id: SectionId, markers: readonly string[]): boolean {
  const lower = id.toLowerCase();
  return markers.some((m) => lower.includes(m));
}

export const frustrationPolicy: LayoutPolicy = Object.freeze({
  id: 'frustration',
  decide(
    context: LayoutContext,
    baseSections: readonly SectionId[],
  ): LayoutPreference {
    const profile = context.affectiveProfile;
    if (!profile) return ABSTAIN;

    const f = profile.frustration;
    if (!Number.isFinite(f) || f < FRUSTRATION_THRESHOLD) return ABSTAIN;

    // Find help/support/contact sections in baseSections order so the
    // pin ordering is stable.
    const pin: SectionId[] = baseSections.filter((id) =>
      matchesAny(id, HELP_MARKERS),
    );
    const hide: SectionId[] = baseSections.filter((id) =>
      matchesAny(id, UPSELL_MARKERS),
    );

    if (pin.length === 0 && hide.length === 0) return ABSTAIN;

    // Weight escalates from 10 → 20 as frustration crosses the high
    // threshold; this lets the engine resolve conflicts with the
    // intent-policy (weight 25) — intent still wins on direct
    // overlap but help still floats above casual recency (weight 5).
    const weight = f >= HIGH_FRUSTRATION_THRESHOLD ? 20 : 10;

    return Object.freeze({
      pin,
      hide,
      boost: Object.freeze({}),
      weight,
      reason: `frustration=${f.toFixed(2)}>=${FRUSTRATION_THRESHOLD}`,
    });
  },
});

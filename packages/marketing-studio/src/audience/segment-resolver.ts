/**
 * Owner-profile + campaign-intent → AudienceSegment resolver.
 *
 * Heuristic mapping for autonomous-mode campaign triggers (e.g. the
 * research worker proposes a buyer-acquisition campaign — the
 * resolver picks `mineral_buyer`). For owner-explicit campaigns the
 * resolver respects the owner's explicit segment selection.
 */

import type { AudienceSegment, OwnerProfile } from '../types.js';

export interface ResolverInput {
  readonly owner_profile: OwnerProfile;
  readonly explicit_segment?: AudienceSegment;
  /** Free-form intent string from the trigger (chat / cron / worker). */
  readonly intent_hint?: string;
}

const INTENT_KEYWORD_MAP: ReadonlyArray<readonly [string, AudienceSegment]> =
  Object.freeze([
    ['investor', 'institutional_investor' as const],
    ['fundraise', 'institutional_investor' as const],
    ['raise', 'institutional_investor' as const],
    ['buyer', 'mineral_buyer' as const],
    ['acquisition', 'mineral_buyer' as const],
    ['regulator', 'regulator' as const],
    ['compliance', 'regulator' as const],
    ['journalist', 'mining_journalist' as const],
    ['press', 'mining_journalist' as const],
    ['public', 'general_public' as const],
    ['partner', 'industry_partner' as const],
    ['owner', 'mining_owner' as const],
    ['operator', 'mining_owner' as const],
  ]);

/**
 * Resolve a segment. Owner-explicit selection wins; otherwise the
 * intent hint is keyword-matched against a closed list. Falls back
 * to `general_public` when no keyword resolves.
 */
export function resolveAudienceSegment(input: ResolverInput): AudienceSegment {
  if (input.explicit_segment !== undefined) {
    return input.explicit_segment;
  }
  const hint = (input.intent_hint ?? '').toLowerCase();
  for (const [kw, seg] of INTENT_KEYWORD_MAP) {
    if (hint.includes(kw)) {
      return seg;
    }
  }
  return 'general_public';
}

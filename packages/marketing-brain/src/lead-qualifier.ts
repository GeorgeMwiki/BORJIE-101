/**
 * Lead Qualifier — detects prospect intent from a marketing chat transcript.
 *
 * Returns the most likely role the visitor is playing, a confidence score,
 * and a suggested routing action (sandbox demo, pricing, waitlist, human).
 *
 * Deterministic keyword + weight classifier. Fast, offline, testable.
 */

import { z } from 'zod';

export const ProspectRoleSchema = z.enum([
  'owner',
  'tenant',
  'manager',
  'station_master',
  'unknown',
]);
export type ProspectRole = z.infer<typeof ProspectRoleSchema>;

export const SuggestedRouteSchema = z.enum([
  'sandbox_demo',
  'pricing_advisor',
  'waitlist_signup',
  'human_handoff',
  'keep_chatting',
]);
export type SuggestedRoute = z.infer<typeof SuggestedRouteSchema>;

export interface QualifiedLead {
  readonly role: ProspectRole;
  readonly confidence: number;
  readonly route: SuggestedRoute;
  readonly portfolioSizeHint: 'micro' | 'small' | 'mid' | 'large' | 'unknown';
  readonly signals: readonly string[];
}

interface RoleKeywords {
  readonly role: ProspectRole;
  readonly keywords: readonly RegExp[];
  readonly weight: number;
}

const ROLE_KEYWORDS: readonly RoleKeywords[] = [
  {
    role: 'owner',
    weight: 1.0,
    keywords: [
      // eslint-disable-next-line security/detect-unsafe-regex -- bounded alternation, no catastrophic backtracking; safe-regex false positive on nested non-capturing groups.
      /\bown\s+(?:a\s+)?(?:property|units?|block|plot|apartment|houses?)\b/i,
      // eslint-disable-next-line security/detect-unsafe-regex -- same: bounded alternation; no quantifier on alternation groups.
      /\bi\s+am\s+(?:an?\s+)?(?:landlord|owner|investor)\b/i,
      /\bmy\s+(?:rental|property|building|estate|portfolio|units?)\b/i,
      /\blandlord\b/i,
      /\bcap\s*rate\b/i,
      /\birr\b/i,
    ],
  },
  {
    role: 'tenant',
    weight: 1.0,
    keywords: [
      // eslint-disable-next-line security/detect-unsafe-regex -- bounded alternation; safe-regex false positive on nested non-capturing groups with no quantifier.
      /\bi\s+(?:am\s+)?(?:a\s+)?tenant\b/i,
      /\bi\s+(?:rent|live\s+in)\b/i,
      /\bmy\s+(?:landlord|rent|apartment|house)\b/i,
      /\bservice\s+charge\b/i,
      /\breceipt\b/i,
      /\brent\s+is\s+due\b/i,
    ],
  },
  {
    role: 'manager',
    weight: 1.0,
    keywords: [
      /\bproperty\s+manager\b/i,
      /\bestate\s+manager\b/i,
      /\bmanaging\s+agent\b/i,
      /\bi\s+manage\s+(?:properties|estates?|units?|buildings?)\b/i,
      /\bclients?\s+own\b/i,
      /\bowner\s+reports?\b/i,
    ],
  },
  {
    role: 'station_master',
    weight: 1.0,
    keywords: [
      /\bstation\s+master\b/i,
      /\bcaretaker\b/i,
      /\bwatchman\b/i,
      /\bsecurity\s+guard\b/i,
      /\bsite\s+supervisor\b/i,
      /\bmlinzi\b/i,
      /\bgate\s+(?:log|camera|watch)\b/i,
    ],
  },
];

const PORTFOLIO_PATTERNS: ReadonlyArray<{ re: RegExp; size: QualifiedLead['portfolioSizeHint'] }> = [
  { re: /\b([1-9])\s*(?:units?|doors?|apartments?|houses?)\b/i, size: 'micro' },
  { re: /\b(1[0-9]|20|2[0-5])\s*(?:units?|doors?)\b/i, size: 'small' },
  { re: /\b(3\d|4\d|5\d|6\d|7\d|8\d|9\d|100|1[0-9][0-9])\s*(?:units?|doors?)\b/i, size: 'mid' },
  { re: /\b([2-9]\d\d|[1-9]\d{3,})\s*(?:units?|doors?)\b/i, size: 'large' },
];

const ROUTE_KEYWORDS: ReadonlyArray<{ re: RegExp; route: SuggestedRoute }> = [
  { re: /\bprice|pricing|cost|plan|tier|subscription|how\s+much\b/i, route: 'pricing_advisor' },
  { re: /\bdemo|try|play|sandbox|test\s+drive\b/i, route: 'sandbox_demo' },
  { re: /\bwaitlist|not\s+ready|maybe\s+later|later\b/i, route: 'waitlist_signup' },
  // eslint-disable-next-line security/detect-unsafe-regex -- bounded alternation; safe-regex false positive on `(?:a\s+)?` inside larger alternation.
  { re: /\btalk\s+to\s+(?:a\s+)?human|call\s+me|sales|book\s+a\s+call\b/i, route: 'human_handoff' },
];

/**
 * Qualify a prospect from their chat transcript.
 * Input is the concatenated visitor-side messages (NOT assistant turns).
 */
export function qualifyLead(visitorText: string): QualifiedLead {
  const signals: string[] = [];
  const scores = new Map<ProspectRole, number>();

  for (const { role, keywords, weight } of ROLE_KEYWORDS) {
    let hits = 0;
    for (const re of keywords) {
      if (re.test(visitorText)) {
        hits += 1;
        signals.push(`${role}:${re.source.slice(0, 30)}`);
      }
    }
    if (hits > 0) scores.set(role, (scores.get(role) ?? 0) + hits * weight);
  }

  let top: ProspectRole = 'unknown';
  let topScore = 0;
  for (const [role, score] of scores) {
    if (score > topScore) {
      top = role;
      topScore = score;
    }
  }

  const totalScore = Array.from(scores.values()).reduce((a, b) => a + b, 0);
  const confidence = totalScore === 0 ? 0 : Math.min(1, topScore / Math.max(1, totalScore));

  let portfolioSizeHint: QualifiedLead['portfolioSizeHint'] = 'unknown';
  for (const { re, size } of PORTFOLIO_PATTERNS) {
    if (re.test(visitorText)) {
      portfolioSizeHint = size;
      break;
    }
  }

  let route: SuggestedRoute = 'keep_chatting';
  for (const { re, route: r } of ROUTE_KEYWORDS) {
    if (re.test(visitorText)) {
      route = r;
      break;
    }
  }

  return { role: top, confidence, route, portfolioSizeHint, signals };
}

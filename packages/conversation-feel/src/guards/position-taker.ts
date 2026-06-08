/**
 * Position-taking enforcer.
 *
 * When the user asks for an opinion or recommendation, the reply must take a
 * position. Hedge limit: max one qualifier. Honest qualifiers are preserved
 * when calibrated confidence is genuinely low.
 *
 * Locale discipline: opinion triggers, hedge phrases, and position markers
 * have separate English and Swahili sets; only the active locale's sets are
 * scanned. The guard never rewrites the reply.
 *
 * References:
 *  - Kahneman, Sibony, Sunstein, "Noise" (2021) — calibrated confidence
 *    versus shotgun hedging.
 *  - Gigerenzer, "Risk Savvy" (2014) — single best estimate over hedge soup.
 */

import type { ConversationContext, Locale } from '../types.js';

const EN_OPINION_TRIGGERS: ReadonlyArray<RegExp> = [
  /\bwhat (do|would) you (think|recommend|suggest|advise)\b/i,
  /\b(your|in your) (opinion|take|view|recommendation|advice)\b/i,
  /\bshould i\b/i,
  /\bwhich (is|would be) (better|best|right)\b/i,
  /\b(recommend|suggest|advise) me\b/i,
  /\b(pick|choose) (one|for me)\b/i,
  /\bwhat would you do\b/i,
];

const SW_OPINION_TRIGGERS: ReadonlyArray<RegExp> = [
  /\b(una(fikiria|pendekeza|shauri)( nini)?)\b/i,
  /\b(maoni|ushauri|mtazamo) (yako|wako)\b/i,
  /\bnifanye nini\b/i,
  /\b(ipi (ni|ingekuwa) (bora|nzuri zaidi))\b/i,
  /\bni(chague|fanye) (gani|nini)\b/i,
  /\bungefanya nini\b/i,
];

const EN_HEDGE_PHRASES: ReadonlyArray<RegExp> = [
  /\b(it )?(could|might|may) be\b/gi,
  /\bperhaps\b/gi,
  /\bpossibly\b/gi,
  /\bit depends\b/gi,
  /\b(sort|kind) of\b/gi,
  /\bmaybe\b/gi,
  /\b(arguably|debatably)\b/gi,
  /\bin (some|certain) (cases|situations|scenarios)\b/gi,
];

const SW_HEDGE_PHRASES: ReadonlyArray<RegExp> = [
  /\binaweza kuwa\b/gi,
  /\blabda\b/gi,
  /\bpengine\b/gi,
  /\binawezekana\b/gi,
  /\binategemea\b/gi,
  /\bhuenda\b/gi,
  /\bkwa namna fulani\b/gi,
  /\bkatika baadhi ya (hali|mazingira)\b/gi,
];

const EN_POSITION_MARKERS: ReadonlyArray<RegExp> = [
  /\b(i (think|believe|recommend|suggest|advise|would))\b/i,
  /\b(my (recommendation|view|take|advice))\b/i,
  /\b(go with|pick|choose) [a-z]+\b/i,
  /\bthe better (choice|option) (is|here is)\b/i,
];

const SW_POSITION_MARKERS: ReadonlyArray<RegExp> = [
  /\b(nina(fikiri|amini|pendekeza|shauri))\b/i,
  /\b(pendekezo|mtazamo|ushauri) (langu|wangu)\b/i,
  /\b(chagua|nenda na) [a-z]+\b/i,
  /\bchaguo bora ni\b/i,
];

export interface PositionCheck {
  readonly user_asked_for_opinion: boolean;
  readonly response_takes_position: boolean;
  readonly hedge_count: number;
  readonly hedge_overload: boolean;
  readonly genuinely_uncertain_allowance: boolean;
  readonly regen_instruction: string | null;
}

const HEDGE_LIMIT_DEFAULT = 1;
const HEDGE_LIMIT_GENUINE_UNCERTAINTY = 3;

/** Pure: detect whether the user explicitly asked for an opinion. */
export function userAskedForOpinion(
  userMessage: string,
  locale: Locale = 'en',
): boolean {
  if (!userMessage) return false;
  const triggers = locale === 'sw' ? SW_OPINION_TRIGGERS : EN_OPINION_TRIGGERS;
  return triggers.some((rx) => rx.test(userMessage));
}

/** Pure: count distinct hedge phrases in the candidate reply. */
export function countHedges(candidate: string, locale: Locale = 'en'): number {
  const phrases = locale === 'sw' ? SW_HEDGE_PHRASES : EN_HEDGE_PHRASES;
  let n = 0;
  for (const rx of phrases) {
    const matches = candidate.match(rx);
    if (matches) n += matches.length;
  }
  return n;
}

/** Pure: does the candidate explicitly take a position? */
export function takesPosition(candidate: string, locale: Locale = 'en'): boolean {
  const markers = locale === 'sw' ? SW_POSITION_MARKERS : EN_POSITION_MARKERS;
  return markers.some((rx) => rx.test(candidate));
}

/**
 * Pure: enforce position-taking. Returns a regen instruction when the user
 * asked for an opinion but the model gave a hedge-everything answer.
 */
export function checkPosition(
  candidate: string,
  ctx: ConversationContext,
): PositionCheck {
  const locale = ctx.locale;
  const opinionAsked =
    ctx.user_asked_for_opinion ?? userAskedForOpinion(ctx.user_message, locale);
  const hedgeCount = countHedges(candidate, locale);
  const position = takesPosition(candidate, locale);
  const genuineUncertainty = ctx.is_genuinely_uncertain ?? false;
  const hedgeLimit = genuineUncertainty
    ? HEDGE_LIMIT_GENUINE_UNCERTAINTY
    : HEDGE_LIMIT_DEFAULT;
  const hedgeOverload = hedgeCount > hedgeLimit;

  let regen: string | null = null;

  if (opinionAsked && !position) {
    regen =
      `The user asked for your opinion. State a clear position using the form: ` +
      `"I think X because Y. The tradeoff: Z." Avoid enumerating options without committing.`;
  } else if (hedgeOverload) {
    regen =
      `Reduce hedge phrases to at most ${hedgeLimit}. Pick the best estimate ` +
      `and state it directly. Keep one honest qualifier only when the calibrated ` +
      `confidence is genuinely low.`;
  }

  return {
    user_asked_for_opinion: opinionAsked,
    response_takes_position: position,
    hedge_count: hedgeCount,
    hedge_overload: hedgeOverload,
    genuinely_uncertain_allowance: genuineUncertainty,
    regen_instruction: regen,
  };
}

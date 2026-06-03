/**
 * Position-taking enforcer.
 *
 * When the user asks for an opinion or recommendation, the response must
 * take a position. Hedge limit: max one qualifier unless the calibrated
 * confidence is genuinely low. Pure.
 *
 * References:
 *  - Kahneman, Sibony, Sunstein, "Noise" (2021) — calibrated confidence
 *    versus shotgun hedging.
 *  - Anthropic, Constitutional AI (2022) — "be honest about uncertainty".
 *
 * Ported from sibling-port guards/position-taker.ts onto Borjie's
 * ConversationContext type.
 */

import type { ConversationContext } from "../types";

const OPINION_TRIGGERS: ReadonlyArray<RegExp> = [
  /\bwhat (do|would) you (think|recommend|suggest|advise)\b/i,
  /\b(your|in your) (opinion|take|view|recommendation|advice)\b/i,
  /\bshould i\b/i,
  /\bwhich (is|would be) (better|best|right)\b/i,
  /\b(recommend|suggest|advise) me\b/i,
  /\b(pick|choose) (one|for me)\b/i,
  /\bwhat would you do\b/i,
];

const HEDGE_PHRASES: ReadonlyArray<RegExp> = [
  /\b(it )?(could|might|may) be\b/gi,
  /\bperhaps\b/gi,
  /\bpossibly\b/gi,
  /\bit depends\b/gi,
  /\b(sort|kind) of\b/gi,
  /\bmaybe\b/gi,
  /\b(arguably|debatably)\b/gi,
  /\bin (some|certain) (cases|situations|scenarios)\b/gi,
];

const POSITION_MARKERS: ReadonlyArray<RegExp> = [
  /\b(i (think|believe|recommend|suggest|advise|would))\b/i,
  /\b(my (recommendation|view|take|advice))\b/i,
  /\b(go with|pick|choose) [a-z]+\b/i,
  /\bthe better (choice|option) (is|here is)\b/i,
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

/** Pure: did the user explicitly ask for an opinion? */
export function userAskedForOpinion(userMessage: string): boolean {
  if (!userMessage) return false;
  return OPINION_TRIGGERS.some((rx) => rx.test(userMessage));
}

/** Pure: count hedge phrases in the candidate. */
export function countHedges(candidate: string): number {
  let n = 0;
  for (const rx of HEDGE_PHRASES) {
    const matches = candidate.match(rx);
    if (matches) n += matches.length;
  }
  return n;
}

/** Pure: does the candidate explicitly take a position? */
export function takesPosition(candidate: string): boolean {
  return POSITION_MARKERS.some((rx) => rx.test(candidate));
}

/** Pure: enforce position-taking; returns regen instruction when hedging. */
export function checkPosition(
  candidate: string,
  ctx: ConversationContext,
): PositionCheck {
  const opinionAsked =
    ctx.user_asked_for_opinion ?? userAskedForOpinion(ctx.user_message);
  const hedgeCount = countHedges(candidate);
  const position = takesPosition(candidate);
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

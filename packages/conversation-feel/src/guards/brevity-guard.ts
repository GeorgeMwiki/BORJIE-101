/**
 * Brevity guard.
 *
 * Per turn type, enforce a target word ceiling. Long answers must justify
 * their length (teaching, trade-offs, concrete scenarios) — not pad.
 * Bullet lists allowed only for 3+ genuinely parallel items. Pure.
 *
 * References:
 *  - Strunk + White, "The Elements of Style" — "Omit needless words."
 *  - Anthropic, prompt-engineering best practices — calibrated length.
 *
 * Ported from sibling-port guards/brevity-guard.ts onto Borjie's
 * TurnKind taxonomy.
 */

import type { TurnKind } from "../types";

export interface BrevityCheck {
  readonly word_count: number;
  readonly limit: number;
  readonly turn_kind: TurnKind;
  readonly within_limit: boolean;
  readonly bullet_count: number;
  readonly bullet_violation: boolean;
  readonly justified: boolean;
  readonly regen_instruction: string | null;
}

const WORD_LIMITS: Record<TurnKind, number> = {
  question: 80,
  smalltalk: 40,
  explanation: 150,
  decision: 120,
  deep_teaching: 300,
};

const TEACHING_JUSTIFICATIONS: ReadonlyArray<RegExp> = [
  /\b(because|since|the reason|why this matters|here'?s why)\b/i,
  /\b(trade-?off|tradeoff|on the other hand|the catch|the risk)\b/i,
  /\b(imagine|picture|consider|suppose|what if)\b/i,
  /\b(step \d|first,|second,|third,|next,|finally,)\b/i,
];

/** Pure: count words. */
export function countWords(text: string): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Pure: count bullet markers. */
export function countBullets(text: string): number {
  if (!text) return 0;
  return (text.match(/^\s*[-*•]\s+/gm) ?? []).length;
}

/** Pure: is long content genuinely justified (>=2 teaching signals)? */
export function isJustifiedLength(text: string): boolean {
  let hits = 0;
  for (const rx of TEACHING_JUSTIFICATIONS) {
    if (rx.test(text)) hits += 1;
  }
  return hits >= 2;
}

/** Pure: brevity check; returns regen instruction when over-limit unjustified. */
export function checkBrevity(
  candidate: string,
  turnKind: TurnKind = "explanation",
): BrevityCheck {
  const wc = countWords(candidate);
  const limit = WORD_LIMITS[turnKind];
  const withinLimit = wc <= limit;
  const bullets = countBullets(candidate);
  const justified = isJustifiedLength(candidate);
  const bulletViolation = bullets > 0 && bullets < 3;

  let regen: string | null = null;
  if (!withinLimit && !justified) {
    regen =
      `Tighten to under ${limit} words for a ${turnKind} turn. ` +
      `Length is currently ${wc} words. Earn extra length by teaching, ` +
      `showing trade-offs, or imagining a concrete scenario; otherwise cut.`;
  } else if (bulletViolation) {
    regen =
      `Replace the ${bullets}-bullet list with prose. Bullets are only ` +
      `allowed for 3 or more parallel items.`;
  }

  return {
    word_count: wc,
    limit,
    turn_kind: turnKind,
    within_limit: withinLimit,
    bullet_count: bullets,
    bullet_violation: bulletViolation,
    justified,
    regen_instruction: regen,
  };
}

/** Pure: infer a sensible turn kind from the user message + candidate length. */
export function inferTurnKind(
  userMessage: string,
  candidate: string,
): TurnKind {
  const u = (userMessage ?? "").trim();
  if (u.length === 0) return "explanation";
  if (/^(hi|hello|hey|sup|yo|hola|mambo|habari)\b/i.test(u)) return "smalltalk";
  if (/^(what|how|why|when|where|who|which)\b/i.test(u) && u.length < 80) {
    return "question";
  }
  if (/\b(should i|recommend|advise|decide|pick|choose)\b/i.test(u)) {
    return "decision";
  }
  if (/\b(explain|teach|walk me through|help me understand|deep dive)\b/i.test(u)) {
    return "deep_teaching";
  }
  if (countWords(candidate) > 200) return "deep_teaching";
  return "explanation";
}

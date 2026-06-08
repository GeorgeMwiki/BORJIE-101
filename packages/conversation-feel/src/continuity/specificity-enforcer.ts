/**
 * Specificity enforcer.
 *
 * When the reply references the user's input, it must reproduce their actual
 * words for proper nouns, amounts, and dates. Paraphrase loses specificity.
 * Numbers and dates may not be rounded silently.
 *
 * Locale discipline: the vague-date detector recognises both English and
 * Swahili relative-time phrases. The guard never rewrites the reply.
 *
 * References:
 *  - Sacks, "Lectures on Conversation" (1992) — exact-word recycling.
 *  - Tversky + Kahneman, "Anchoring" (1974) — reference numbers anchor;
 *    rounding misleads.
 */

import type { ConversationContext, Locale } from '../types.js';

export interface SpecificityCheck {
  readonly missing_user_words: ReadonlyArray<string>;
  readonly rounded_numbers: ReadonlyArray<{
    user_value: string;
    response_value: string;
  }>;
  readonly paraphrased_dates: ReadonlyArray<{
    user_value: string;
    response_value: string;
  }>;
  readonly is_specific: boolean;
  readonly regen_instruction: string | null;
}

const PROPER_NOUN_RX = /\b([A-Z][a-z]{2,})\b/g;
// Amount detector spanning all Borjie-supported currency tokens (TZS launch,
// KES/UGX/NGN/USD expansion) plus bare symbols — comparison only.
const AMOUNT_RX =
  /\b(?:tsh|tzs|usd|ksh|kes|ush|ugx|ngn|\$|€|£)?\s*([0-9]+(?:[.,][0-9]+)*(?:\s*(?:k|m|million|thousand))?)\b/gi;
const DATE_RX =
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}(?:[,\s]+\d{4})?\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/gi;

const EN_VAGUE_DATE_RX =
  /\b(soon|recently|last (week|month|year)|next (week|month|year))\b/i;
const SW_VAGUE_DATE_RX =
  /\b(hivi karibuni|karibuni|(wiki|mwezi|mwaka) (uliopita|ujao))\b/i;

/** Pure: extract specific tokens (proper nouns, amounts, dates) from text. */
export function extractSpecifics(text: string): {
  proper_nouns: ReadonlyArray<string>;
  amounts: ReadonlyArray<string>;
  dates: ReadonlyArray<string>;
} {
  if (!text) return { proper_nouns: [], amounts: [], dates: [] };
  const nouns = Array.from(text.matchAll(PROPER_NOUN_RX), (m) => m[1] ?? '').filter(
    Boolean,
  );
  const amounts = Array.from(text.matchAll(AMOUNT_RX), (m) => m[0].trim()).filter(
    (s) => /\d/.test(s),
  );
  const dates = Array.from(text.matchAll(DATE_RX), (m) => m[0]);
  return {
    proper_nouns: dedupe(nouns),
    amounts: dedupe(amounts),
    dates: dedupe(dates),
  };
}

function dedupe(arr: ReadonlyArray<string>): ReadonlyArray<string> {
  return Array.from(new Set(arr));
}

/** Pure: detect rounded numbers (reply uses 5,000 when user said 5,123). */
function detectRounding(
  userAmounts: ReadonlyArray<string>,
  responseAmounts: ReadonlyArray<string>,
): ReadonlyArray<{ user_value: string; response_value: string }> {
  const out: { user_value: string; response_value: string }[] = [];
  for (const u of userAmounts) {
    const uNum = parseAmount(u);
    if (uNum === null) continue;
    for (const r of responseAmounts) {
      const rNum = parseAmount(r);
      if (rNum === null) continue;
      // Same magnitude but rounded differently.
      if (
        rNum !== uNum &&
        Math.abs(rNum - uNum) / Math.max(1, Math.abs(uNum)) < 0.1 &&
        isRoundNumber(rNum) &&
        !isRoundNumber(uNum)
      ) {
        out.push({ user_value: u, response_value: r });
      }
    }
  }
  return out;
}

function parseAmount(raw: string): number | null {
  const s = raw.toLowerCase().replace(/[,$€£\s]|tsh|tzs|usd|ksh|kes|ush|ugx|ngn/g, '');
  let mult = 1;
  let body = s;
  if (s.endsWith('k') || s.endsWith('thousand')) {
    mult = 1000;
    body = s.replace(/k|thousand/g, '');
  } else if (s.endsWith('m') || s.endsWith('million')) {
    mult = 1_000_000;
    body = s.replace(/m|million/g, '');
  }
  const n = Number(body.replace(/,/g, ''));
  return Number.isFinite(n) ? n * mult : null;
}

function isRoundNumber(n: number): boolean {
  if (n === 0) return true;
  const abs = Math.abs(n);
  const order = Math.pow(10, Math.floor(Math.log10(abs)));
  return abs % order === 0;
}

/** Pure: full specificity check. */
export function checkSpecificity(
  candidate: string,
  ctx: ConversationContext,
): SpecificityCheck {
  const locale: Locale = ctx.locale;
  const userMsg = ctx.user_message ?? '';
  const userSpec = extractSpecifics(userMsg);
  const respSpec = extractSpecifics(candidate);
  const vagueRx = locale === 'sw' ? SW_VAGUE_DATE_RX : EN_VAGUE_DATE_RX;

  const missingNouns = userSpec.proper_nouns.filter(
    (n) => n.length >= 3 && !candidate.includes(n),
  );

  const rounded = detectRounding(userSpec.amounts, respSpec.amounts);

  // Date paraphrase: candidate replaces an exact date with a vague form.
  const dateParaphrase: { user_value: string; response_value: string }[] = [];
  for (const ud of userSpec.dates) {
    if (!candidate.includes(ud) && vagueRx.test(candidate)) {
      const m = candidate.match(vagueRx);
      dateParaphrase.push({
        user_value: ud,
        response_value: m ? m[0] : '(vague)',
      });
    }
  }

  const isSpecific =
    missingNouns.length === 0 && rounded.length === 0 && dateParaphrase.length === 0;

  let regen: string | null = null;
  if (!isSpecific) {
    const fragments: string[] = [];
    if (missingNouns.length > 0) {
      fragments.push(
        `Use the user's exact names: ${missingNouns.slice(0, 3).join(', ')}`,
      );
    }
    const firstRounded = rounded[0];
    if (firstRounded) {
      fragments.push(
        `Do not round amounts. Keep "${firstRounded.user_value}" as the user wrote it (you wrote "${firstRounded.response_value}").`,
      );
    }
    const firstDate = dateParaphrase[0];
    if (firstDate) {
      fragments.push(
        `Use the exact date "${firstDate.user_value}", not "${firstDate.response_value}".`,
      );
    }
    regen = fragments.join(' ');
  }

  return {
    missing_user_words: missingNouns,
    rounded_numbers: rounded,
    paraphrased_dates: dateParaphrase,
    is_specific: isSpecific,
    regen_instruction: regen,
  };
}

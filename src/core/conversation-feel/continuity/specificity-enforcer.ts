/**
 * Specificity enforcer.
 *
 * When the response references the user's input, it must reproduce their
 * actual words for proper nouns, amounts, and dates. Paraphrase loses
 * specificity. Numbers and dates may not be rounded silently.
 *
 * References:
 *  - Sacks, "Lectures on Conversation" (1992) — exact-word recycling.
 *  - Grice, "Logic and Conversation" (1975) — maxim of manner: be precise.
 *  - Tversky + Kahneman, "Anchoring" (1974) — reference numbers anchor;
 *    rounding misleads.
 */

import type { ConversationContext } from "../types";

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
const AMOUNT_RX =
  /\b(?:tsh|tzs|usd|ksh|\$|€|£)?\s*([0-9]+(?:[.,][0-9]+)*(?:\s*(?:k|m|million|thousand))?)\b/gi;
const DATE_RX =
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}(?:[,\s]+\d{4})?\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/gi;

/**
 * Pure: extract specific tokens (proper nouns, amounts, dates) from text.
 */
export function extractSpecifics(text: string): {
  proper_nouns: ReadonlyArray<string>;
  amounts: ReadonlyArray<string>;
  dates: ReadonlyArray<string>;
} {
  if (!text) return { proper_nouns: [], amounts: [], dates: [] };
  const nouns = Array.from(text.matchAll(PROPER_NOUN_RX), (m) => m[1]);
  const amounts = Array.from(text.matchAll(AMOUNT_RX), (m) =>
    m[0].trim(),
  ).filter((s) => /\d/.test(s));
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

/**
 * Pure: detect rounded numbers (response uses 5,000 when user said 5,123).
 */
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
  const s = raw.toLowerCase().replace(/[,$€£\s]|tsh|tzs|usd|ksh/g, "");
  let mult = 1;
  let body = s;
  if (s.endsWith("k") || s.endsWith("thousand")) {
    mult = 1000;
    body = s.replace(/k|thousand/g, "");
  } else if (s.endsWith("m") || s.endsWith("million")) {
    mult = 1_000_000;
    body = s.replace(/m|million/g, "");
  }
  const n = Number(body.replace(/,/g, ""));
  return Number.isFinite(n) ? n * mult : null;
}

function isRoundNumber(n: number): boolean {
  if (n === 0) return true;
  const abs = Math.abs(n);
  // "Very round" relative to magnitude: nearest 10% of leading order.
  const order = Math.pow(10, Math.floor(Math.log10(abs)));
  // E.g. 5,000,000 has order 1,000,000; rounded to 1M-multiple → very round.
  return abs % order === 0;
}

/**
 * Pure: full specificity check.
 */
export function checkSpecificity(
  candidate: string,
  ctx: ConversationContext,
): SpecificityCheck {
  const userMsg = ctx.user_message ?? "";
  const userSpec = extractSpecifics(userMsg);
  const respSpec = extractSpecifics(candidate);

  const missingNouns = userSpec.proper_nouns.filter(
    (n) => n.length >= 3 && !candidate.includes(n),
  );

  const rounded = detectRounding(userSpec.amounts, respSpec.amounts);

  // Date paraphrase: candidate uses month-only when user gave full date.
  const dateParaphrase: { user_value: string; response_value: string }[] = [];
  for (const ud of userSpec.dates) {
    if (!candidate.includes(ud)) {
      // See if response replaces it with a vague form.
      if (
        /\b(soon|recently|last (week|month|year)|next (week|month|year))\b/i.test(
          candidate,
        )
      ) {
        const m = candidate.match(
          /\b(soon|recently|last (week|month|year)|next (week|month|year))\b/i,
        );
        dateParaphrase.push({
          user_value: ud,
          response_value: m ? m[0] : "(vague)",
        });
      }
    }
  }

  const isSpecific =
    missingNouns.length === 0 &&
    rounded.length === 0 &&
    dateParaphrase.length === 0;

  let regen: string | null = null;
  if (!isSpecific) {
    const fragments: string[] = [];
    if (missingNouns.length > 0) {
      fragments.push(
        `Use the user's exact names: ${missingNouns.slice(0, 3).join(", ")}`,
      );
    }
    if (rounded.length > 0) {
      fragments.push(
        `Do not round amounts. Keep "${rounded[0].user_value}" as the user wrote it (you wrote "${rounded[0].response_value}").`,
      );
    }
    if (dateParaphrase.length > 0) {
      fragments.push(
        `Use the exact date "${dateParaphrase[0].user_value}", not "${dateParaphrase[0].response_value}".`,
      );
    }
    regen = fragments.join(" ");
  }

  return {
    missing_user_words: missingNouns,
    rounded_numbers: rounded,
    paraphrased_dates: dateParaphrase,
    is_specific: isSpecific,
    regen_instruction: regen,
  };
}

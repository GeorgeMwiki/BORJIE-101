/**
 * Sycophancy detector.
 *
 * Detects when the assistant agrees with a user assertion despite evidence
 * (extracted facts, memory, world-model output) pointing the other way.
 * Forces respectful pushback rather than fawning agreement.
 *
 * Locale discipline: agreement and assertion patterns have separate English
 * and Swahili sets; only the active locale's sets are scanned. The regen
 * instruction is produced in the active locale.
 *
 * References:
 *  - Sharma, Shoham, Kadavath et al., "Towards Understanding Sycophancy in
 *    Language Models", Anthropic (2024).
 *  - Anthropic, "Constitutional AI" (2022) — honesty over agreement.
 */

import type { ConversationContext, Locale, UserFact } from '../types.js';

export interface UserAssertion {
  readonly key: string;
  readonly asserted_value: string;
  readonly span: string;
}

export interface ContradictoryEvidence {
  readonly source: 'session_fact' | 'memory_episode' | 'world_model';
  readonly key: string;
  readonly true_value: string;
  readonly assertion_value: string;
  readonly confidence: number;
}

export interface SycophancyCheck {
  readonly detected: boolean;
  readonly assertion: UserAssertion | null;
  readonly evidence: ContradictoryEvidence | null;
  readonly response_agrees: boolean;
  readonly regen_instruction: string | null;
}

const EN_AGREEMENT_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(yes|yep|yeah|correct|right|exactly|absolutely)\b/i,
  /\byou('?re| are) (right|correct)\b/i,
  /\bthat'?s (right|correct|true)\b/i,
  /\bthat'?s a fair (point|assessment)\b/i,
];

const SW_AGREEMENT_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(ndiyo|sahihi|sawa|hakika|kabisa)\b/i,
  /\b(uko|upo) sahihi\b/i,
  /\b(hiyo|hilo) ni (sahihi|kweli|sawa)\b/i,
  /\bni hoja (nzuri|ya haki)\b/i,
];

// Capture group 1 = key, group 2 = copula, group 3 = value.
const EN_FACT_ASSERTION_PATTERN =
  /\b(?:my|i have|i've) ([a-z][a-z\s]{1,40}?) (is|are|was|were|of) ([a-z0-9.,\s]{1,40})\b/i;
// sw: "<key> yangu ni <value>".
const SW_FACT_ASSERTION_PATTERN =
  /\b([a-z][a-z\s]{1,40}?) (yangu|wangu|langu) (ni|ilikuwa) ([a-z0-9.,\s]{1,40})\b/i;

/** Pure: try to extract a fact-shaped assertion from the user message. */
export function extractAssertion(
  userMessage: string,
  locale: Locale = 'en',
): UserAssertion | null {
  if (!userMessage) return null;
  if (locale === 'sw') {
    const m = userMessage.match(SW_FACT_ASSERTION_PATTERN);
    if (!m || !m[1] || !m[4] || !m[0]) return null;
    return { key: m[1].trim(), asserted_value: m[4].trim(), span: m[0] };
  }
  const m = userMessage.match(EN_FACT_ASSERTION_PATTERN);
  if (!m || !m[1] || !m[3] || !m[0]) return null;
  return { key: m[1].trim(), asserted_value: m[3].trim(), span: m[0] };
}

/** Pure: does the candidate reply express agreement? */
export function expressesAgreement(
  candidate: string,
  locale: Locale = 'en',
): boolean {
  const patterns = locale === 'sw' ? SW_AGREEMENT_PATTERNS : EN_AGREEMENT_PATTERNS;
  return patterns.some((rx) => rx.test(candidate));
}

/**
 * Pure: cross-check assertion against known facts. Returns evidence when the
 * user is wrong about something already known.
 */
export function findContradiction(
  assertion: UserAssertion,
  facts: ReadonlyArray<UserFact>,
): ContradictoryEvidence | null {
  const aKey = normalizeKey(assertion.key);
  for (const fact of facts) {
    const fKey = normalizeKey(fact.key);
    if (
      (fKey.includes(aKey) || aKey.includes(fKey)) &&
      normalizeValue(fact.value) !== normalizeValue(assertion.asserted_value)
    ) {
      return {
        source: 'session_fact',
        key: fact.key,
        true_value: fact.value,
        assertion_value: assertion.asserted_value,
        confidence: 0.85,
      };
    }
  }
  return null;
}

function normalizeKey(k: string): string {
  return k
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();
}

function normalizeValue(v: string): string {
  // Strip currency tokens for all Borjie-supported currencies (TZS launch,
  // KES/UGX/NGN/USD expansion) so "5,000 TZS" and "5000" compare equal.
  // Never hard-codes a single currency into a money path — this is
  // comparison-only normalization, not rendering.
  return v
    .toLowerCase()
    .replace(/\b(tsh|tzs|usd|ksh|kes|ush|ugx|ngn|naira|shillings?)\b/g, '')
    .replace(/[\s,.$€£]+/g, '')
    .trim();
}

/** Pure: full sycophancy check. Detects agreement-with-contradiction. */
export function checkSycophancy(
  candidate: string,
  ctx: ConversationContext,
  externalEvidence?: ContradictoryEvidence | null,
): SycophancyCheck {
  const locale = ctx.locale;
  const assertion = extractAssertion(ctx.user_message, locale);
  const agreement = expressesAgreement(candidate, locale);
  let evidence = externalEvidence ?? null;

  if (assertion && !evidence && ctx.known_user_facts) {
    evidence = findContradiction(assertion, ctx.known_user_facts);
  }

  const detected = agreement && evidence !== null;

  let regen: string | null = null;
  if (detected && evidence && assertion) {
    regen =
      locale === 'sw'
        ? `Mtumiaji alisema "${assertion.span}" lakini taarifa ya kipindi inaonyesha ${evidence.key} ` +
          `ni "${evidence.true_value}". Usikubali tu. Eleza tofauti kwa heshima: ` +
          `"Awali ulitaja ${evidence.true_value} kwa ${evidence.key} — kuna kilichobadilika?"`
        : `The user asserted "${assertion.span}" but a session fact says ${evidence.key} ` +
          `is "${evidence.true_value}". Do not simply agree. Respectfully note the ` +
          `discrepancy: "Earlier you mentioned ${evidence.true_value} for ${evidence.key} — ` +
          `did something change?"`;
  }

  return {
    detected,
    assertion,
    evidence,
    response_agrees: agreement,
    regen_instruction: regen,
  };
}

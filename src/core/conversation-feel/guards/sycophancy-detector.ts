/**
 * Sycophancy detector.
 *
 * Detects when the assistant agrees with a user assertion despite evidence
 * (extracted facts, memory v2 episodes, world-model output) pointing the
 * other way. Forces respectful pushback rather than fawning agreement.
 *
 * References:
 *  - Sharma, Shoham, Kadavath et al., "Towards Understanding Sycophancy
 *    in Language Models", Anthropic (2024).
 *  - Ouyang et al., InstructGPT (2022) — RLHF reward hacking that produces
 *    sycophancy.
 *  - Anthropic, Constitutional AI (2022) — honesty over agreement.
 */

import type { ConversationContext, UserFact } from "../types";

export interface UserAssertion {
  readonly key: string;
  readonly asserted_value: string;
  readonly span: string;
}

export interface ContradictoryEvidence {
  readonly source: "session_fact" | "memory_episode" | "world_model";
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

const AGREEMENT_PATTERNS = [
  /\b(yes|yep|yeah|correct|right|exactly|absolutely)\b/i,
  /\byou('?re| are) (right|correct)\b/i,
  /\bthat'?s (right|correct|true)\b/i,
  /\bthat'?s a fair (point|assessment)\b/i,
];

// Capture group 1 = "my" | "i have" | "i've", group 2 = key,
// group 3 = is/are/was/were/of, group 4 = value.
const FACT_ASSERTION_PATTERN =
  /\b(?:my|i have|i've) ([a-z][a-z\s]{1,40}?) (is|are|was|were|of) ([a-z0-9.,\s]{1,40})\b/i;

/**
 * Pure: try to extract a fact-shaped assertion from the user message.
 */
export function extractAssertion(userMessage: string): UserAssertion | null {
  if (!userMessage) return null;
  const m = userMessage.match(FACT_ASSERTION_PATTERN);
  if (!m) return null;
  return {
    key: m[1].trim(),
    asserted_value: m[3].trim(),
    span: m[0],
  };
}

/**
 * Pure: does the candidate response express agreement?
 */
export function expressesAgreement(candidate: string): boolean {
  return AGREEMENT_PATTERNS.some((rx) => rx.test(candidate));
}

/**
 * Pure: cross-check assertion against known facts. Returns evidence when
 * the user is wrong about something we already know.
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
        source: "session_fact",
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
    .replace(/[\s_-]+/g, " ")
    .trim();
}

function normalizeValue(v: string): string {
  return v
    .toLowerCase()
    .replace(/\b(tsh|tzs|usd|ksh|kes|shillings?)\b/g, "")
    .replace(/[\s,.$€£]+/g, "")
    .trim();
}

/**
 * Pure: full sycophancy check. Detects agreement-with-contradiction.
 */
export function checkSycophancy(
  candidate: string,
  ctx: ConversationContext,
  externalEvidence?: ContradictoryEvidence | null,
): SycophancyCheck {
  const assertion = extractAssertion(ctx.user_message);
  const agreement = expressesAgreement(candidate);
  let evidence = externalEvidence ?? null;

  if (assertion && !evidence && ctx.known_user_facts) {
    evidence = findContradiction(assertion, ctx.known_user_facts);
  }

  const detected = agreement && evidence !== null;

  let regen: string | null = null;
  if (detected && evidence && assertion) {
    regen =
      `The user asserted "${assertion.span}" but session fact says ${evidence.key} ` +
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

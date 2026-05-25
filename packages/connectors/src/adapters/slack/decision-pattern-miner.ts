/**
 * Slack decision-pattern miner — pure-function stub.
 *
 * Recognises the "approve after receipt" intent from a Slack message
 * body. This is the canonical example from §3.1 of
 * `.audit/litfin-sota-2026-05-23/11-company-brain-primitive.md`:
 * the "James in Slack always asks for the maintenance receipt before
 * approving" rule. v1 returns deterministic keyword-match output so
 * tests can assert exact behavior; the production chi-squared
 * pattern-extractor lives in
 * `packages/ai-copilot/src/learning-loop/pattern-extractor.ts` and
 * runs over the trajectory store, NOT over individual messages.
 *
 * Why a stub here, in the connector layer:
 *   - The connector emits `comms.slack.inbound` brain events; the
 *     downstream consolidation-worker mines the trajectory store. But
 *     for v1 we want the brain emitter to attach a coarse
 *     `recognisedIntent` tag at ingest time so the bus consumer can
 *     route obvious cases (approve / escalate / quote) without a
 *     round-trip to the miner.
 *   - The stub is intentionally narrow (keyword match, no ML, no
 *     LLM, no graph lookup) so the connector stays dep-free and the
 *     miner stays a pure function (trivially testable).
 *   - The output shape matches what the real chi-squared miner will
 *     return — same `SlackMinedPattern` interface — so swapping in
 *     the production miner later is a one-line composition change.
 *
 * Determinism contract: `mineMessagePattern(message)` MUST return the
 * same `SlackMinedPattern` for the same input across processes and
 * across time. No `Math.random`, no `Date.now`, no I/O. The
 * deterministic-cases test asserts this.
 */

import type { SlackMinedPattern, SlackRecognisedIntent } from './types.js';

// ============================================================================
// Keyword rules
// ============================================================================

/**
 * Lowercase keyword phrases that signal each intent. Order matters:
 * we check `approve-after-receipt` BEFORE `request-quote` because
 * "send me the receipt before I approve" should win over the more
 * generic "quote" mention.
 *
 * Rules are intentionally narrow — false positives are worse than
 * false negatives at the connector layer. The trajectory miner picks
 * up the long tail.
 */
interface IntentRule {
  readonly intent: SlackRecognisedIntent;
  /** All phrases must appear (AND) within the message body. */
  readonly requiredPhrases: ReadonlyArray<string>;
  /**
   * Optional negative phrases — if any appear, this rule does NOT
   * fire even when all `requiredPhrases` match. Used to filter
   * obvious negations ("don't send the receipt").
   */
  readonly negativePhrases?: ReadonlyArray<string>;
  /**
   * Stub chi-squared value the miner reports for a matching event.
   * Pulled from the §3.1 example (chi-sq = 18.4 for the
   * receipt-before-approve pattern across 47/52 of James's flows).
   * Production code computes this live; v1 stub-returns the literal
   * so consumers can assert on the shape and value.
   */
  readonly stubChiSquared: number;
}

const RULES: ReadonlyArray<IntentRule> = [
  {
    intent: 'approve-after-receipt',
    // Two-token AND: must mention both "receipt" + an approval verb.
    requiredPhrases: ['receipt', 'approve'],
    negativePhrases: [
      "don't approve",
      'do not approve',
      'cannot approve',
      'no receipt needed',
    ],
    stubChiSquared: 18.4,
  },
  {
    intent: 'escalate-to-legal',
    requiredPhrases: ['escalate', 'legal'],
    stubChiSquared: 12.1,
  },
  {
    intent: 'request-quote',
    requiredPhrases: ['quote'],
    negativePhrases: ['no quote', 'quote was already sent'],
    stubChiSquared: 7.8,
  },
];

// ============================================================================
// Public API
// ============================================================================

/**
 * Run the keyword rules over a single Slack message body. Returns
 * the first matching rule's intent + stub chi-squared, or
 * `{ intent: 'unknown', confidence: 0, triggerKeywords: [] }` when
 * nothing matches.
 *
 * Pure: same input → same output, no I/O, no randomness.
 *
 * The function accepts `string | undefined` because Slack messages
 * may carry no text body (e.g. file-share with no caption). Undefined
 * or empty text always returns `unknown`.
 */
export function mineMessagePattern(text: string | undefined | null): SlackMinedPattern {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return {
      intent: 'unknown',
      confidence: 0,
      triggerKeywords: [],
    };
  }

  const lower = text.toLowerCase();

  for (const rule of RULES) {
    // Negative-phrase short-circuit.
    if (rule.negativePhrases?.some((neg) => lower.includes(neg))) {
      continue;
    }
    // All required phrases must appear.
    const allMatch = rule.requiredPhrases.every((req) => lower.includes(req));
    if (!allMatch) continue;

    return {
      intent: rule.intent,
      // Deterministic confidence: 1.0 when ALL required phrases match
      // and no negative phrase triggered. The production miner will
      // return p-value-derived confidence in [0, 1].
      confidence: 1,
      triggerKeywords: rule.requiredPhrases,
      chiSquared: rule.stubChiSquared,
    };
  }

  return {
    intent: 'unknown',
    confidence: 0,
    triggerKeywords: [],
  };
}

/**
 * Default rule set, exported for tests that want to introspect the
 * shipping rules without re-implementing them.
 */
export const SLACK_MINER_RULES: ReadonlyArray<IntentRule> = RULES;

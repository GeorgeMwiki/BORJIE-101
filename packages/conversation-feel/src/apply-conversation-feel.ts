/**
 * `applyConversationFeel` — the deterministic, fail-open output stage.
 *
 * This is the single function the reply path (persona-voice's response
 * styler) calls on the assistant's outgoing text. It applies only the guards
 * that SILENTLY rewrite text without losing substance:
 *
 *   1. anti-pattern strip  — remove filler openers/closers/apologies.
 *   2. uncertainty theatre — remove theatrical apology wrapping an admission.
 *
 * The check-only guards (continuity / position / sycophancy / brevity /
 * specificity) produce regen *instructions*, not text edits, so they belong
 * in `runPreSendAudit`, not here. This keeps the output stage a pure string
 * transform.
 *
 * Two hard invariants:
 *
 *   - FAIL-OPEN. Every step is wrapped. If anything throws, the original text
 *     is returned unchanged. A guard can NEVER break or drop a reply.
 *
 *   - LOCALE-PURE. The locale is threaded into both steps; only the active
 *     locale's rules run. No step ever introduces a word in the other
 *     language, so an `en` reply stays `en` and an `sw` reply stays `sw`.
 *
 * If stripping would gut the reply (most of it was filler), the ORIGINAL is
 * kept — better a slightly chatty real answer than a near-empty one. The
 * full regen loop in `runPreSendAudit` is the place to ask for a rewrite.
 */

import type { Locale, RemovedPhrase } from './types.js';
import {
  shouldRequestRegen,
  stripChatbotFeel,
} from './guards/anti-pattern-stripper.js';
import { stripTheatreFromUncertainty } from './guards/honest-uncertainty.js';

export interface ConversationFeelResult {
  /** The cleaned reply text. Equals the input when nothing changed or a
   *  guard failed open. */
  readonly text: string;
  /** TRUE when at least one guard altered the text. */
  readonly changed: boolean;
  /** Filler phrases removed by the anti-pattern strip (empty on no-op). */
  readonly removed_phrases: ReadonlyArray<RemovedPhrase>;
  /** TRUE when a guard threw and the original text was returned unchanged. */
  readonly failed_open: boolean;
}

/**
 * Apply the deterministic, fail-open conversation-feel pass to outgoing
 * reply text. Synchronous and side-effect-free.
 *
 * @param text   the assistant's outgoing reply.
 * @param locale the active locale; rules run for this language only.
 */
export function applyConversationFeel(
  text: string,
  locale: Locale = 'en',
): ConversationFeelResult {
  // Guard the input shape first — never throw on bad input.
  if (typeof text !== 'string' || text.length === 0) {
    return {
      text: typeof text === 'string' ? text : '',
      changed: false,
      removed_phrases: [],
      failed_open: false,
    };
  }

  let working = text;
  let removed: ReadonlyArray<RemovedPhrase> = [];
  let failedOpen = false;

  // Step 1: anti-pattern strip (fail-open).
  try {
    const stripped = stripChatbotFeel(working, locale);
    // Only adopt the stripped text when it would not gut the reply. If most
    // of the reply was filler, keep the original — do not ship near-empty.
    if (
      stripped.removed_phrases.length > 0 &&
      !shouldRequestRegen(stripped) &&
      stripped.stripped.trim().length > 0
    ) {
      working = stripped.stripped;
      removed = stripped.removed_phrases;
    }
  } catch {
    // Fail-open: keep the text we had before this step.
    failedOpen = true;
  }

  // Step 2: uncertainty theatre strip (fail-open).
  try {
    const cleaned = stripTheatreFromUncertainty(working, locale);
    if (cleaned.length > 0 && cleaned !== working) {
      working = cleaned;
    }
  } catch {
    failedOpen = true;
  }

  // Final safety net: never return empty when we started non-empty.
  if (working.trim().length === 0) {
    return {
      text,
      changed: false,
      removed_phrases: [],
      failed_open: failedOpen,
    };
  }

  return {
    text: working,
    changed: working !== text,
    removed_phrases: removed,
    failed_open: failedOpen,
  };
}

/**
 * Piece L — Intent classifier.
 *
 * Classifies the user/assistant exchange into one of five intents:
 *   request_info | propose_action | file_event | ask_for_help | ambiguous
 *
 * Default implementation is a heuristic regex classifier (no LLM)
 * so dispatch latency stays sub-10ms in the hot path. A Haiku-backed
 * `createLlmIntentClassifier` exists for the (rare) case the heuristic
 * comes back `ambiguous` — that path is opt-in at composition time so
 * unit tests don't need an Anthropic client.
 *
 * Why heuristic-first: the keyword/regex landscape covers ~88% of
 * captures in the Borjie corpus (estate-manager Swahili/English).
 * The 12% that come back `ambiguous` are usually multi-clause requests
 * where the heuristic correctly defers to the LLM fallback.
 *
 * Cache: results are content-hashed and memoised across calls so a
 * repeated identical exchange doesn't repay the cost. Cache is process-
 * local; for cross-process sharing the composition root can wrap with
 * a Redis layer.
 */

import { createHash } from 'crypto';
import type {
  Intent,
  IntentClassifier,
  IntentClassifierArgs,
  IntentClassifierResult,
} from './types.js';

// ─── Heuristic keyword bags ────────────────────────────────────────────

const REQUEST_INFO_KEYWORDS = [
  /\b(what|when|where|why|how|who)\b/i,
  /\b(tell me|show me|list|find|search|lookup)\b/i,
  /\b(do (we|you|i) have|is there|are there)\b/i,
  /\b(nini|wapi|lini|nani|vipi|gani)\b/i, // Swahili equivalents
  // '?' anywhere is a strong signal of a question.
  /\?/,
];

const PROPOSE_ACTION_KEYWORDS = [
  /\b(wants? to|would like to|intends? to|plans? to)\b/i,
  /\b(let'?s|let us|we should|we need to|can we|could we)\b/i,
  /\b(create|add|register|open|raise|file|start|launch|begin|initiate|enrol|onboard|sign\s?up)\b/i,
  // "rent" alone is too generic ("the rent for X"); require a verb context.
  /\b(lease (this|that|the|a)|move\s?in|take up|book|reserve)\b/i,
  /\b(anataka|nataka|wataka)\b/i, // Swahili "wants to"
];

const FILE_EVENT_KEYWORDS = [
  /\b(received|paid|completed|finished|done|closed)\b/i,
  /\b(meter\s?reading|payment\s?received|invoice\s?paid|ticket\s?closed)\b/i,
  /\b(I (just )?paid|we (just )?paid|payment of)\b/i,
  /\b(arrived|delivered|installed|repaired|fixed)\b/i,
  /\b(nimelipa|amelipa|imekamilika)\b/i, // Swahili "I/they paid", "completed"
];

const ASK_FOR_HELP_KEYWORDS = [
  /\b(help|stuck|confused|not\s?sure|don'?t know|cannot|can'?t)\b/i,
  /\b(advice|recommend|suggest|what should|what would)\b/i,
  /\b(problem|issue|trouble|broken|down|failing)\b/i,
  /\b(saidia|nisaidie)\b/i, // Swahili "help"
  // Distress signals — combined with a question word lean toward
  // ask_for_help rather than request_info.
  /\bI'?m (stuck|lost|confused|unsure)\b/i,
  /\bI am (stuck|lost|confused|unsure)\b/i,
];

// ─── Public ports ──────────────────────────────────────────────────────

export interface IntentClassifierOptions {
  /** When set, ambiguous heuristic results escalate to this LLM port. */
  readonly fallback?: IntentClassifier;
  /** Disable in-process cache for tests asserting on call count. */
  readonly disableCache?: boolean;
}

/**
 * Heuristic intent classifier. Pure function over (user_text, assistant_text).
 *
 * Returns:
 *   - one of the four concrete intents with confidence 0.7..0.95 when
 *     at least one keyword bag matches conclusively
 *   - 'ambiguous' with confidence 0.3 when no bag dominates
 */
export function classifyIntentHeuristic(
  args: IntentClassifierArgs,
): IntentClassifierResult {
  const text = `${args.user_text}\n${args.assistant_text}`;
  const buckets: Record<Exclude<Intent, 'ambiguous'>, number> = {
    request_info: countMatches(text, REQUEST_INFO_KEYWORDS),
    propose_action: countMatches(text, PROPOSE_ACTION_KEYWORDS),
    file_event: countMatches(text, FILE_EVENT_KEYWORDS),
    ask_for_help: countMatches(text, ASK_FOR_HELP_KEYWORDS),
  };

  // Best bucket wins; tie → ambiguous.
  const entries = Object.entries(buckets) as Array<[Intent, number]>;
  const ranked = [...entries].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const second = ranked[1];
  if (!top || !second) {
    return {
      intent: 'ambiguous',
      confidence: 0.3,
      rationale: 'no keyword buckets',
    };
  }
  const [topIntent, topCount] = top;
  const [secondIntent, secondCount] = second;

  if (topCount === 0) {
    return {
      intent: 'ambiguous',
      confidence: 0.3,
      rationale: 'no keyword matches',
    };
  }

  if (topCount === secondCount) {
    return {
      intent: 'ambiguous',
      confidence: 0.4,
      rationale: `tie between ${topIntent} and ${secondIntent}`,
    };
  }

  // Confidence scales with margin: more dominant = higher confidence.
  const margin = topCount - secondCount;
  const confidence = Math.min(0.7 + margin * 0.075, 0.95);
  return {
    intent: topIntent,
    confidence,
    rationale: `top=${topIntent}(${topCount}) second=${secondIntent}(${secondCount})`,
  };
}

/**
 * Build the production-ready intent classifier with optional LLM
 * fallback + in-process cache.
 */
export function createIntentClassifier(
  opts: IntentClassifierOptions = {},
): IntentClassifier {
  const cache = new Map<string, IntentClassifierResult>();

  return async (args) => {
    const key = hashArgs(args);
    if (!opts.disableCache) {
      const cached = cache.get(key);
      if (cached) return cached;
    }

    const heuristic = classifyIntentHeuristic(args);
    if (heuristic.intent !== 'ambiguous' || !opts.fallback) {
      if (!opts.disableCache) cache.set(key, heuristic);
      return heuristic;
    }

    // Heuristic was ambiguous AND we have an LLM fallback — try it.
    try {
      const llm = await opts.fallback(args);
      if (!opts.disableCache) cache.set(key, llm);
      return llm;
    } catch (_err) {
      // LLM failure: keep heuristic ambiguous (do not throw — dispatch
      // tolerates ambiguous intents by dropping the proposal).
      if (!opts.disableCache) cache.set(key, heuristic);
      return heuristic;
    }
  };
}

// ─── Internals ─────────────────────────────────────────────────────────

function countMatches(text: string, patterns: ReadonlyArray<RegExp>): number {
  let n = 0;
  for (const re of patterns) {
    if (re.test(text)) n += 1;
  }
  return n;
}

function hashArgs(args: IntentClassifierArgs): string {
  return createHash('sha256')
    .update(`${args.persona_id}|${args.user_text}|${args.assistant_text}`)
    .digest('hex');
}

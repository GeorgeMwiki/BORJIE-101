/**
 * Continuity enforcer.
 *
 * Every response at turn >= 2 must reference something the user actually
 * said in the recent window: a quoted phrase, a fact they shared, or a
 * thread they started. Without continuity, replies feel transactional and
 * chatbot-like.
 *
 * References:
 *  - Grice, "Logic and Conversation" (1975) — cooperative principle, maxim
 *    of relation: be relevant.
 *  - Sacks + Schegloff, "Opening Up Closings" (1973, 2024 reissue) — how
 *    human turns reference prior turns.
 *  - Clark, "Using Language" (1996) — common ground as continuity backbone.
 */

import type { ConversationContext, RecentTurn, UserFact } from "../types";

export interface ContinuityCheck {
  readonly has_continuity: boolean;
  readonly missing_link_reason: string | null;
  readonly suggested_anchor: string | null;
  readonly anchor_kind: "quote" | "fact_callback" | "thread_continue" | "none";
  readonly regen_instruction: string | null;
}

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "of",
  "in",
  "on",
  "at",
  "to",
  "for",
  "with",
  "by",
  "from",
  "about",
  "as",
  "and",
  "or",
  "but",
  "if",
  "then",
  "than",
  "so",
  "this",
  "that",
  "these",
  "those",
  "it",
  "they",
  "them",
  "their",
  "i",
  "you",
  "we",
  "he",
  "she",
  "him",
  "her",
  "my",
  "your",
  "our",
  "what",
  "when",
  "where",
  "why",
  "how",
  "can",
  "will",
  "would",
  "should",
  "could",
  "may",
  "might",
  "just",
  "very",
  "really",
  "also",
  "too",
  "much",
  "more",
  "most",
  "some",
  "any",
  "all",
  "no",
  "not",
  "only",
  "now",
  "still",
  "here",
  "there",
]);

/**
 * Pure: extract substantive tokens (lowercased, stopwords filtered).
 */
function extractTokens(text: string): ReadonlyArray<string> {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

/**
 * Pure: check whether the candidate response references any recent user
 * turn or known fact. Returns suggestion when continuity is missing.
 */
export function checkContinuity(
  candidate: string,
  ctx: ConversationContext,
): ContinuityCheck {
  if (ctx.turn_index < 2) {
    return {
      has_continuity: true,
      missing_link_reason: null,
      suggested_anchor: null,
      anchor_kind: "none",
      regen_instruction: null,
    };
  }

  const userTurns = ctx.recent_turns.filter((t) => t.role === "user").slice(-5);

  if (userTurns.length === 0) {
    return {
      has_continuity: true,
      missing_link_reason: null,
      suggested_anchor: null,
      anchor_kind: "none",
      regen_instruction: null,
    };
  }

  const candidateLower = candidate.toLowerCase();
  const candidateTokens = new Set(extractTokens(candidate));

  // Direct quote check: does candidate contain a 3+ word run from any
  // recent user turn?
  for (const turn of userTurns) {
    if (containsThreeWordRun(candidate, turn.content)) {
      return {
        has_continuity: true,
        missing_link_reason: null,
        suggested_anchor: null,
        anchor_kind: "quote",
        regen_instruction: null,
      };
    }
  }

  // Fact callback: does candidate mention a known user fact value?
  if (ctx.known_user_facts && ctx.known_user_facts.length > 0) {
    for (const fact of ctx.known_user_facts) {
      if (fact.value && candidateLower.includes(fact.value.toLowerCase())) {
        return {
          has_continuity: true,
          missing_link_reason: null,
          suggested_anchor: null,
          anchor_kind: "fact_callback",
          regen_instruction: null,
        };
      }
    }
  }

  // Token overlap with the most recent user turn.
  const lastUserTokens = new Set(
    extractTokens(userTurns[userTurns.length - 1].content),
  );
  let overlap = 0;
  for (const tok of lastUserTokens) {
    if (candidateTokens.has(tok)) overlap++;
  }
  if (lastUserTokens.size > 0) {
    const ratio = overlap / lastUserTokens.size;
    if (ratio >= 0.2) {
      return {
        has_continuity: true,
        missing_link_reason: null,
        suggested_anchor: null,
        anchor_kind: "thread_continue",
        regen_instruction: null,
      };
    }
  }

  // No continuity link found. Suggest one.
  const anchor = pickAnchor(userTurns, ctx.known_user_facts ?? []);
  const regen =
    `Reference the user's specific words from the recent turns. ` +
    (anchor
      ? `Anchor your reply on this concrete element: "${anchor}".`
      : `Quote at least one word or phrase the user actually used.`);

  return {
    has_continuity: false,
    missing_link_reason:
      "Response does not reference any recent user turn or known fact",
    suggested_anchor: anchor,
    anchor_kind: anchor ? "quote" : "none",
    regen_instruction: regen,
  };
}

function containsThreeWordRun(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase();
  const tokens = needle
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
  for (let i = 0; i + 3 <= tokens.length; i++) {
    const phrase = tokens.slice(i, i + 3).join(" ");
    if (phrase.length >= 8 && h.includes(phrase)) return true;
  }
  return false;
}

function pickAnchor(
  userTurns: ReadonlyArray<RecentTurn>,
  facts: ReadonlyArray<UserFact>,
): string | null {
  if (facts.length > 0) {
    return facts[facts.length - 1].value;
  }
  const last = userTurns[userTurns.length - 1];
  if (!last) return null;
  const tokens = extractTokens(last.content);
  if (tokens.length === 0) return null;
  // Prefer the longest substantive token.
  return (
    tokens.reduce((best, t) => (t.length > best.length ? t : best), "") || null
  );
}

/**
 * Track session continuity stats. Pure builder.
 */
export interface ContinuitySessionState {
  readonly session_id: string;
  readonly known_facts: ReadonlyArray<UserFact>;
  readonly open_threads: ReadonlyArray<string>;
}

export function recordFact(
  state: ContinuitySessionState,
  fact: UserFact,
): ContinuitySessionState {
  // Immutable update.
  if (state.known_facts.some((f) => f.key === fact.key)) {
    return {
      ...state,
      known_facts: state.known_facts.map((f) =>
        f.key === fact.key ? fact : f,
      ),
    };
  }
  return {
    ...state,
    known_facts: [...state.known_facts, fact],
  };
}

export function openThread(
  state: ContinuitySessionState,
  thread: string,
): ContinuitySessionState {
  if (state.open_threads.includes(thread)) return state;
  return { ...state, open_threads: [...state.open_threads, thread] };
}

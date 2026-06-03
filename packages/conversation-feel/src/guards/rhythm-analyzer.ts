/**
 * Conversation rhythm analyzer.
 *
 * Chatbots stream uniformly: same length, no questions back, no pauses.
 * Humans vary length, ask back, and signal pauses. This module scores
 * recent assistant turns to detect a flatlined chatbot rhythm. Pure.
 *
 * References:
 *  - Sacks, Schegloff, Jefferson, "Turn-Taking" (1974, 2024 reissue).
 *  - Brennan + Clark, "Conceptual pacts" (1996) - variation in turns.
 *
 * Ported from sibling-port style-audit/rhythm-analyzer.ts onto Borjie's
 * RecentTurn + RhythmScore types.
 */

import type { RecentTurn, RhythmScore } from "../types";

// Pause signals the model may legitimately use. The em-dash is
// deliberately NOT a recognised pause signal: Borjie forbids em-dashes
// in customer-facing text, so we never reward or suggest one.
const PAUSE_SIGNAL_RX = /(\bhmm,?\b|\.\.\.|\bwait,?\b|\blet me check\b)/i;
const QUESTION_BACK_RX = /\?\s*$/m;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function variance(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return (
    values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / values.length
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pure: compute rhythm score from recent turns.
 *
 * flatlined when (assistant turns >= 3) AND variance < 5 AND
 * question_back_ratio == 0 AND pause_signals == 0.
 */
export function analyzeRhythm(
  turns: ReadonlyArray<RecentTurn>,
  windowSize: number = 6,
): RhythmScore {
  const assistant = turns
    .filter((t) => t.role === "assistant")
    .slice(-windowSize);
  if (assistant.length === 0) {
    return {
      variance: 0,
      question_back_ratio: 0,
      pause_signals: 0,
      flatlined: false,
      turns_analyzed: 0,
    };
  }
  const lengths = assistant.map((t) => wordCount(t.content));
  const variance_ = variance(lengths);
  const questionBack = assistant.filter((t) =>
    QUESTION_BACK_RX.test(t.content),
  ).length;
  const pause = assistant.reduce(
    (n, t) => n + (PAUSE_SIGNAL_RX.test(t.content) ? 1 : 0),
    0,
  );
  const ratio = questionBack / assistant.length;
  const flatlined =
    assistant.length >= 3 && variance_ < 5 && ratio === 0 && pause === 0;
  return {
    variance: round2(variance_),
    question_back_ratio: round2(ratio),
    pause_signals: pause,
    flatlined,
    turns_analyzed: assistant.length,
  };
}

/** Pure: when rhythm flatlines, produce a tone-prompt injection. */
export function rhythmInjection(score: RhythmScore): string | null {
  if (!score.flatlined) return null;
  return [
    "Conversation rhythm has flatlined. Break the pattern this turn:",
    "either (a) vary length sharply versus your last reply,",
    "(b) end with a real question to the user,",
    "or (c) signal a brief pause in words (for example \"hmm\" or a short",
    "reflective aside) when honesty calls for it; do not use dashes for this.",
    "Do not stack all three; pick one and use it naturally.",
  ].join(" ");
}

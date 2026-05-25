/**
 * Handoff Detector — decides when Mr. Mwikila should emit a
 * `handoff_to_signup` event.
 *
 * Rules:
 *   1. 5+ meaningful visitor turns (>= 5 chars, non-whitespace), OR
 *   2. Explicit signup intent detected in the latest message.
 *
 * Pure function — no I/O. The router calls this after each turn and
 * emits the handoff event if the detector returns true.
 */

export interface HandoffInput {
  readonly transcript: readonly { role: 'visitor' | 'assistant'; content: string }[];
  readonly latestMessage: string;
}

export interface HandoffDecision {
  readonly shouldHandoff: boolean;
  readonly reason: 'turn_threshold' | 'explicit_intent' | 'none';
  readonly meaningfulTurnCount: number;
  readonly explicitIntentSignal: string | null;
}

const EXPLICIT_INTENT_PATTERNS: readonly RegExp[] = [
  /\bsign\s*me\s*up\b/i,
  // eslint-disable-next-line security/detect-unsafe-regex -- alternation groups have no unbounded quantifiers; no catastrophic-backtracking risk. `safe-regex` flags nested non-capturing alternations as a false positive.
  /\b(?:i\s+want\s+to|i\s+would\s+like\s+to|lets|let's|let\s+us)\s+(?:sign\s*up|start|get\s*started|create\s+(?:an\s+)?account)\b/i,
  /\bready\s+to\s+(?:sign\s*up|start|get\s*started)\b/i,
  /\bcreate\s+(?:my|an)\s+account\b/i,
  /\bhow\s+do\s+i\s+sign\s+up\b/i,
  /\bkaribu\s*(?:sign|account)\b/i,
];

const MIN_MEANINGFUL_CHARS = 5;
const TURN_THRESHOLD = 5;

export function detectHandoff(input: HandoffInput): HandoffDecision {
  const visitorTurns = input.transcript.filter((t) => t.role === 'visitor');
  const meaningful = visitorTurns.filter(
    (t) => t.content.trim().length >= MIN_MEANINGFUL_CHARS
  );
  const meaningfulTurnCount = meaningful.length;

  const explicitSignal = findExplicitIntent(input.latestMessage);
  if (explicitSignal) {
    return {
      shouldHandoff: true,
      reason: 'explicit_intent',
      meaningfulTurnCount,
      explicitIntentSignal: explicitSignal,
    };
  }

  if (meaningfulTurnCount >= TURN_THRESHOLD) {
    return {
      shouldHandoff: true,
      reason: 'turn_threshold',
      meaningfulTurnCount,
      explicitIntentSignal: null,
    };
  }

  return {
    shouldHandoff: false,
    reason: 'none',
    meaningfulTurnCount,
    explicitIntentSignal: null,
  };
}

function findExplicitIntent(message: string): string | null {
  for (const re of EXPLICIT_INTENT_PATTERNS) {
    const m = message.match(re);
    if (m) return m[0];
  }
  return null;
}

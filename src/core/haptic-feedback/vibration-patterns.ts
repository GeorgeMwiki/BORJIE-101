// =============================================================================
// Vibration Patterns — Pre-defined haptic feedback for learning reinforcement
// Uses the Web Vibration API (navigator.vibrate)
// =============================================================================

import type {
  CustomPatternInput,
  GamificationEvent,
  HapticPattern,
  HapticType,
  VibrationEntry,
} from "./types";

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

function computeDuration(vibrations: readonly VibrationEntry[]): number {
  return vibrations.reduce((sum, v) => sum + v.duration + v.pause, 0);
}

function makePattern(
  id: string,
  name: string,
  type: HapticType,
  vibrations: readonly VibrationEntry[],
): HapticPattern {
  return {
    id,
    name,
    type,
    vibrations,
    duration: computeDuration(vibrations),
  };
}

const HAPTIC_PATTERNS: Readonly<Record<HapticType, HapticPattern>> = {
  success: makePattern("success", "Success", "success", [
    { duration: 50, pause: 50 },
    { duration: 100, pause: 0 },
  ]),

  error: makePattern("error", "Error", "error", [
    { duration: 200, pause: 100 },
    { duration: 200, pause: 100 },
    { duration: 200, pause: 0 },
  ]),

  warning: makePattern("warning", "Warning", "warning", [
    { duration: 100, pause: 80 },
    { duration: 100, pause: 0 },
  ]),

  celebration: makePattern("celebration", "Celebration", "celebration", [
    { duration: 30, pause: 30 },
    { duration: 50, pause: 30 },
    { duration: 70, pause: 30 },
    { duration: 100, pause: 40 },
    { duration: 150, pause: 50 },
    { duration: 200, pause: 0 },
  ]),

  encouragement: makePattern(
    "encouragement",
    "Encouragement",
    "encouragement",
    [
      { duration: 40, pause: 40 },
      { duration: 80, pause: 0 },
    ],
  ),

  timer_tick: makePattern("timer_tick", "Timer Tick", "timer_tick", [
    { duration: 20, pause: 0 },
  ]),

  streak_pulse: makePattern("streak_pulse", "Streak Pulse", "streak_pulse", [
    { duration: 80, pause: 120 },
    { duration: 80, pause: 120 },
    { duration: 80, pause: 0 },
  ]),

  level_up: makePattern("level_up", "Level Up", "level_up", [
    { duration: 50, pause: 50 },
    { duration: 80, pause: 50 },
    { duration: 120, pause: 60 },
    { duration: 160, pause: 70 },
    { duration: 250, pause: 0 },
  ]),

  achievement: makePattern("achievement", "Achievement", "achievement", [
    { duration: 40, pause: 30 },
    { duration: 60, pause: 30 },
    { duration: 40, pause: 60 },
    { duration: 100, pause: 40 },
    { duration: 60, pause: 30 },
    { duration: 200, pause: 0 },
  ]),

  quiz_countdown: makePattern(
    "quiz_countdown",
    "Quiz Countdown",
    "quiz_countdown",
    [
      { duration: 30, pause: 200 },
      { duration: 30, pause: 180 },
      { duration: 30, pause: 150 },
      { duration: 30, pause: 120 },
      { duration: 50, pause: 80 },
      { duration: 50, pause: 50 },
      { duration: 80, pause: 0 },
    ],
  ),

  correct_answer: makePattern(
    "correct_answer",
    "Correct Answer",
    "correct_answer",
    [
      { duration: 40, pause: 30 },
      { duration: 120, pause: 0 },
    ],
  ),

  wrong_answer: makePattern("wrong_answer", "Wrong Answer", "wrong_answer", [
    { duration: 150, pause: 80 },
    { duration: 150, pause: 0 },
  ]),

  milestone: makePattern("milestone", "Milestone", "milestone", [
    { duration: 60, pause: 40 },
    { duration: 60, pause: 40 },
    { duration: 100, pause: 60 },
    { duration: 60, pause: 40 },
    { duration: 60, pause: 40 },
    { duration: 200, pause: 0 },
  ]),
};

// ---------------------------------------------------------------------------
// Gamification event mapping
// ---------------------------------------------------------------------------

const GAME_EVENT_MAP: Readonly<Record<GamificationEvent, HapticType>> = {
  quiz_correct: "correct_answer",
  quiz_incorrect: "wrong_answer",
  streak_continued: "streak_pulse",
  streak_broken: "warning",
  level_up: "level_up",
  badge_earned: "achievement",
  concept_mastered: "celebration",
  daily_goal_met: "milestone",
  session_complete: "success",
  leaderboard_rank_up: "celebration",
  perfect_score: "celebration",
  first_attempt_correct: "encouragement",
  timer_warning: "timer_tick",
  countdown_tick: "quiz_countdown",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isHapticSupported(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.navigator !== "undefined" &&
    typeof globalThis.navigator.vibrate === "function"
  );
}

export function patternToVibrationArray(
  pattern: HapticPattern,
): readonly number[] {
  const result: number[] = [];

  for (let i = 0; i < pattern.vibrations.length; i++) {
    const entry = pattern.vibrations[i];
    result.push(entry.duration);

    // Add pause unless it's the last entry with 0 pause
    const isLast = i === pattern.vibrations.length - 1;
    if (!isLast || entry.pause > 0) {
      result.push(entry.pause);
    }
  }

  return result;
}

export function triggerHaptic(type: HapticType): boolean {
  if (!isHapticSupported()) return false;

  const pattern = HAPTIC_PATTERNS[type];
  if (!pattern) return false;

  const vibrationArray = patternToVibrationArray(pattern);
  return globalThis.navigator.vibrate(vibrationArray as number[]);
}

export function createCustomPattern(input: CustomPatternInput): HapticPattern {
  const id = `custom_${input.name.toLowerCase().replace(/\s+/g, "_")}`;
  return makePattern(id, input.name, input.type, input.vibrations);
}

export function triggerCustomPattern(pattern: HapticPattern): boolean {
  if (!isHapticSupported()) return false;

  const vibrationArray = patternToVibrationArray(pattern);
  return globalThis.navigator.vibrate(vibrationArray as number[]);
}

export function hapticForGameEvent(event: GamificationEvent): boolean {
  const hapticType = GAME_EVENT_MAP[event];
  if (!hapticType) return false;

  return triggerHaptic(hapticType);
}

export function cancelHaptic(): void {
  if (!isHapticSupported()) return;
  globalThis.navigator.vibrate(0);
}

export function getPattern(type: HapticType): HapticPattern {
  return HAPTIC_PATTERNS[type];
}

export function getAllPatterns(): readonly HapticPattern[] {
  return Object.values(HAPTIC_PATTERNS);
}

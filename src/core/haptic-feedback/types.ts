// =============================================================================
// Haptic Feedback System — Type Definitions
// Vibration patterns for mobile learning reinforcement
// =============================================================================

// ---------------------------------------------------------------------------
// Haptic event taxonomy
// ---------------------------------------------------------------------------

export type HapticType =
  | "success"
  | "error"
  | "warning"
  | "celebration"
  | "encouragement"
  | "timer_tick"
  | "streak_pulse"
  | "level_up"
  | "achievement"
  | "quiz_countdown"
  | "correct_answer"
  | "wrong_answer"
  | "milestone";

// ---------------------------------------------------------------------------
// Vibration entries
// ---------------------------------------------------------------------------

export interface VibrationEntry {
  readonly duration: number; // ms of vibration
  readonly pause: number; // ms of pause after
  readonly intensity?: number; // 0-1 (not all devices support)
}

// ---------------------------------------------------------------------------
// Haptic patterns
// ---------------------------------------------------------------------------

export interface HapticPattern {
  readonly id: string;
  readonly name: string;
  readonly type: HapticType;
  readonly vibrations: readonly VibrationEntry[];
  readonly duration: number; // total ms
}

// ---------------------------------------------------------------------------
// Gamification event mapping
// ---------------------------------------------------------------------------

export type GamificationEvent =
  | "quiz_correct"
  | "quiz_incorrect"
  | "streak_continued"
  | "streak_broken"
  | "level_up"
  | "badge_earned"
  | "concept_mastered"
  | "daily_goal_met"
  | "session_complete"
  | "leaderboard_rank_up"
  | "perfect_score"
  | "first_attempt_correct"
  | "timer_warning"
  | "countdown_tick";

// ---------------------------------------------------------------------------
// Haptic feedback options
// ---------------------------------------------------------------------------

export interface HapticOptions {
  readonly enabled: boolean;
  readonly intensityMultiplier: number; // 0-2, global scale
  readonly respectSilentMode: boolean;
}

// ---------------------------------------------------------------------------
// Custom pattern builder input
// ---------------------------------------------------------------------------

export interface CustomPatternInput {
  readonly name: string;
  readonly type: HapticType;
  readonly vibrations: readonly VibrationEntry[];
}

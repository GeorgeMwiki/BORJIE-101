/**
 * Celebration Engine
 *
 * Central celebration trigger system that dispatches dopamine-inducing
 * micro-celebrations across the Borjie platform. Uses CustomEvent dispatch
 * pattern consistent with existing borjie-navigate events.
 *
 * All celebration types map to confetti configs, sound cue keys,
 * XP amounts, and bilingual messages (English + Swahili).
 *
 * @module core/dopamine-design/celebration-engine
 */

// ============================================================================
// CELEBRATION TYPES
// ============================================================================

export type CelebrationType =
  | "quiz_correct"
  | "quiz_streak"
  | "concept_mastered"
  | "module_completed"
  | "readiness_milestone"
  | "brs_increase"
  | "first_login"
  | "streak_day"
  | "perfect_score"
  | "level_up"
  | "graduation"
  | "document_uploaded"
  | "form_completed"
  | "loan_submitted";

export type ConfettiStyle = "burst" | "shower" | "fireworks";

export type SoundCue =
  | "success_chime"
  | "level_up_fanfare"
  | "streak_fire"
  | "achievement_unlock"
  | "coin_collect"
  | "applause"
  | "graduation_march"
  | "submit_whoosh";

// ============================================================================
// CELEBRATION SPECIFICATION
// ============================================================================

export interface CelebrationSpec {
  readonly confettiStyle: ConfettiStyle;
  readonly confettiParticleCount: number;
  readonly confettiColors: readonly string[];
  readonly soundCue: SoundCue;
  readonly xpAmount: number;
  readonly message: {
    readonly en: string;
    readonly sw: string;
  };
  readonly icon: string;
  readonly duration: number;
}

// ============================================================================
// CELEBRATION CONFIG
// ============================================================================

export const CELEBRATION_CONFIG: Readonly<
  Record<CelebrationType, CelebrationSpec>
> = {
  quiz_correct: {
    confettiStyle: "burst",
    confettiParticleCount: 30,
    confettiColors: ["#10b981", "#34d399", "#6ee7b7"],
    soundCue: "coin_collect",
    xpAmount: 10,
    message: {
      en: "Correct! Great job!",
      sw: "Sahihi! Kazi nzuri!",
    },
    icon: "check_circle",
    duration: 1500,
  },
  quiz_streak: {
    confettiStyle: "burst",
    confettiParticleCount: 50,
    confettiColors: ["#f59e0b", "#fbbf24", "#fcd34d", "#ef4444"],
    soundCue: "streak_fire",
    xpAmount: 15,
    message: {
      en: "You are on fire! Keep going!",
      sw: "Uko kwenye moto! Endelea!",
    },
    icon: "local_fire_department",
    duration: 2000,
  },
  concept_mastered: {
    confettiStyle: "shower",
    confettiParticleCount: 80,
    confettiColors: ["#8b5cf6", "#a78bfa", "#c4b5fd", "#fbbf24"],
    soundCue: "achievement_unlock",
    xpAmount: 50,
    message: {
      en: "Concept mastered! You are becoming an expert.",
      sw: "Dhana imeeleweka! Unakuwa mtaalamu.",
    },
    icon: "school",
    duration: 3000,
  },
  module_completed: {
    confettiStyle: "shower",
    confettiParticleCount: 100,
    confettiColors: ["#3b82f6", "#60a5fa", "#93c5fd", "#fbbf24"],
    soundCue: "applause",
    xpAmount: 100,
    message: {
      en: "Module complete! Outstanding progress.",
      sw: "Somo limekamilika! Maendeleo bora.",
    },
    icon: "verified",
    duration: 3500,
  },
  readiness_milestone: {
    confettiStyle: "shower",
    confettiParticleCount: 70,
    confettiColors: ["#14b8a6", "#2dd4bf", "#5eead4", "#fbbf24"],
    soundCue: "achievement_unlock",
    xpAmount: 75,
    message: {
      en: "Readiness milestone reached! You are getting closer.",
      sw: "Hatua ya utayari imefikiwa! Unakaribia.",
    },
    icon: "trending_up",
    duration: 3000,
  },
  brs_increase: {
    confettiStyle: "burst",
    confettiParticleCount: 40,
    confettiColors: ["#06b6d4", "#22d3ee", "#67e8f9"],
    soundCue: "success_chime",
    xpAmount: 20,
    message: {
      en: "Your Business Readiness Score just went up!",
      sw: "Alama yako ya Utayari wa Biashara imeongezeka!",
    },
    icon: "insights",
    duration: 2000,
  },
  first_login: {
    confettiStyle: "fireworks",
    confettiParticleCount: 120,
    confettiColors: ["#6366f1", "#818cf8", "#fbbf24", "#f472b6"],
    soundCue: "level_up_fanfare",
    xpAmount: 25,
    message: {
      en: "Welcome to Borjie! Your journey begins now.",
      sw: "Karibu Borjie! Safari yako inaanza sasa.",
    },
    icon: "celebration",
    duration: 4000,
  },
  streak_day: {
    confettiStyle: "burst",
    confettiParticleCount: 45,
    confettiColors: ["#f97316", "#fb923c", "#fdba74", "#fbbf24"],
    soundCue: "streak_fire",
    xpAmount: 10,
    message: {
      en: "Streak extended! Consistency builds success.",
      sw: "Mfululizo umeongezeka! Uthabiti hujenga mafanikio.",
    },
    icon: "local_fire_department",
    duration: 2000,
  },
  perfect_score: {
    confettiStyle: "fireworks",
    confettiParticleCount: 150,
    confettiColors: ["#eab308", "#fbbf24", "#fcd34d", "#ffffff"],
    soundCue: "applause",
    xpAmount: 25,
    message: {
      en: "Perfect score! Absolutely flawless!",
      sw: "Alama kamili! Bila kasoro kabisa!",
    },
    icon: "stars",
    duration: 4000,
  },
  level_up: {
    confettiStyle: "fireworks",
    confettiParticleCount: 200,
    confettiColors: ["#6366f1", "#818cf8", "#a5b4fc", "#fbbf24", "#f472b6"],
    soundCue: "level_up_fanfare",
    xpAmount: 0,
    message: {
      en: "Level up! You have reached a new level!",
      sw: "Kiwango kipya! Umefika kiwango kipya!",
    },
    icon: "arrow_upward",
    duration: 5000,
  },
  graduation: {
    confettiStyle: "fireworks",
    confettiParticleCount: 250,
    confettiColors: ["#8b5cf6", "#a78bfa", "#fbbf24", "#f472b6", "#34d399"],
    soundCue: "graduation_march",
    xpAmount: 500,
    message: {
      en: "Congratulations, graduate! You have earned your certificate!",
      sw: "Hongera, mhitimu! Umepata cheti chako!",
    },
    icon: "emoji_events",
    duration: 6000,
  },
  document_uploaded: {
    confettiStyle: "burst",
    confettiParticleCount: 25,
    confettiColors: ["#10b981", "#34d399", "#6ee7b7"],
    soundCue: "coin_collect",
    xpAmount: 15,
    message: {
      en: "Document uploaded successfully!",
      sw: "Hati imepakiwa kwa mafanikio!",
    },
    icon: "upload_file",
    duration: 1500,
  },
  form_completed: {
    confettiStyle: "burst",
    confettiParticleCount: 35,
    confettiColors: ["#3b82f6", "#60a5fa", "#93c5fd"],
    soundCue: "success_chime",
    xpAmount: 20,
    message: {
      en: "Section complete! Keep going!",
      sw: "Sehemu imekamilika! Endelea!",
    },
    icon: "task_alt",
    duration: 1800,
  },
  loan_submitted: {
    confettiStyle: "fireworks",
    confettiParticleCount: 180,
    confettiColors: ["#10b981", "#34d399", "#fbbf24", "#6366f1", "#f472b6"],
    soundCue: "applause",
    xpAmount: 200,
    message: {
      en: "Application submitted! A major milestone in your journey.",
      sw: "Maombi yamewasilishwa! Hatua kubwa katika safari yako.",
    },
    icon: "send",
    duration: 5000,
  },
} as const;

// ============================================================================
// CELEBRATION EVENT TYPES
// ============================================================================

export interface CelebrationEventDetail {
  readonly type: CelebrationType;
  readonly spec: CelebrationSpec;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly timestamp: number;
}

export interface XPGainedEventDetail {
  readonly amount: number;
  readonly source: CelebrationType;
  readonly newTotal: number;
  readonly leveledUp: boolean;
  readonly newLevel?: number;
  readonly timestamp: number;
}

export interface AchievementUnlockedEventDetail {
  readonly badgeId: string;
  readonly timestamp: number;
}

// ============================================================================
// EVENT NAME CONSTANTS
// ============================================================================

export const CELEBRATION_EVENT = "borjie-celebration" as const;
export const XP_GAINED_EVENT = "borjie-xp-gained" as const;
export const ACHIEVEMENT_UNLOCKED_EVENT =
  "borjie-achievement-unlocked" as const;

// ============================================================================
// CELEBRATION TRIGGER FUNCTION
// ============================================================================

/**
 * Trigger a celebration event. Dispatches a CustomEvent on the window
 * that celebration UI components can listen for and respond to.
 *
 * This is a side-effecting function (dispatches DOM events) but is the
 * single point of mutation in the celebration system.
 *
 * @param type - The celebration type to trigger
 * @param data - Optional additional data to include in the event
 */
export function triggerCelebration(
  type: CelebrationType,
  data?: Readonly<Record<string, unknown>>,
): void {
  if (typeof window === "undefined") return;

  // Idempotency: prevent the same celebration from firing more than once per step/session.
  // Uses sessionStorage so celebrations reset only on new browser tab/session.
  const stepKey = data?.step ? String(data.step) : "";
  const dedupKey = `celebration:${type}:${stepKey}`;
  try {
    if (sessionStorage.getItem(dedupKey)) return; // Already celebrated this in current session
    sessionStorage.setItem(dedupKey, String(Date.now()));
  } catch {
    // sessionStorage unavailable (SSR, private mode) — proceed without dedup
  }

  const spec = CELEBRATION_CONFIG[type];
  const detail: CelebrationEventDetail = {
    type,
    spec,
    data,
    timestamp: Date.now(),
  };

  window.dispatchEvent(new CustomEvent(CELEBRATION_EVENT, { detail }));
}

/**
 * Dispatch an XP gained event for the XP toast to pick up.
 *
 * @param amount - XP amount gained
 * @param source - What action triggered the XP gain
 * @param newTotal - User's new total XP
 * @param leveledUp - Whether a level-up occurred
 * @param newLevel - The new level, if leveled up
 */
export function dispatchXPGained(
  amount: number,
  source: CelebrationType,
  newTotal: number,
  leveledUp: boolean,
  newLevel?: number,
): void {
  if (typeof window === "undefined") return;

  // Idempotency: prevent duplicate XP toasts for the same source in current session.
  // Keyed by source + newTotal to allow legitimate distinct XP gains.
  const dedupKey = `xp:${source}:${newTotal}`;
  try {
    if (sessionStorage.getItem(dedupKey)) return;
    sessionStorage.setItem(dedupKey, String(Date.now()));
  } catch {
    // sessionStorage unavailable — proceed without dedup
  }

  const detail: XPGainedEventDetail = {
    amount,
    source,
    newTotal,
    leveledUp,
    newLevel,
    timestamp: Date.now(),
  };

  window.dispatchEvent(new CustomEvent(XP_GAINED_EVENT, { detail }));
}

/**
 * Dispatch an achievement unlocked event.
 *
 * @param badgeId - The badge that was unlocked
 */
export function dispatchAchievementUnlocked(badgeId: string): void {
  if (typeof window === "undefined") return;

  const detail: AchievementUnlockedEventDetail = {
    badgeId,
    timestamp: Date.now(),
  };

  window.dispatchEvent(new CustomEvent(ACHIEVEMENT_UNLOCKED_EVENT, { detail }));
}

/**
 * Convenience function that triggers celebration, dispatches XP,
 * and optionally fires achievement unlock, all from a single call.
 *
 * @param type - Celebration type
 * @param currentXP - User's current XP before this action
 * @param currentLevel - User's current level before this action
 * @param calculateLevelFn - Pure function to calculate level from XP
 * @param data - Optional extra data
 */
export function triggerFullCelebration(
  type: CelebrationType,
  currentXP: number,
  currentLevel: number,
  calculateLevelFn: (xp: number) => number,
  data?: Readonly<Record<string, unknown>>,
): {
  readonly newXP: number;
  readonly newLevel: number;
  readonly leveledUp: boolean;
} {
  const spec = CELEBRATION_CONFIG[type];
  const newXP = currentXP + spec.xpAmount;
  const newLevel = calculateLevelFn(newXP);
  const leveledUp = newLevel > currentLevel;

  triggerCelebration(type, data);
  dispatchXPGained(
    spec.xpAmount,
    type,
    newXP,
    leveledUp,
    leveledUp ? newLevel : undefined,
  );

  if (leveledUp) {
    triggerCelebration("level_up", { level: newLevel });
  }

  return { newXP, newLevel, leveledUp };
}

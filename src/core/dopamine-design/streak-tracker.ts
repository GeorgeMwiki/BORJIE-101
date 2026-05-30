/**
 * Streak Tracker
 *
 * Pure functions for streak and consistency tracking.
 * Calculates streaks from login dates, determines active status,
 * provides streak rewards at milestone intervals, and generates
 * bilingual streak messages.
 *
 * Grace period: 36 hours (accommodates timezone differences).
 * All functions are pure with no side effects.
 *
 * @module core/dopamine-design/streak-tracker
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Grace period in milliseconds (36 hours) */
const GRACE_PERIOD_MS = 36 * 60 * 60 * 1000;

/** One day in milliseconds */
// eslint-disable-next-line unused-imports/no-unused-vars -- variable kept for API compatibility / destructuring clarity; prefix with _ to silence permanently
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// STREAK MILESTONE DEFINITIONS
// ============================================================================

export interface StreakMilestoneDefinition {
  readonly days: number;
  readonly xpReward: number;
  readonly title: {
    readonly en: string;
    readonly sw: string;
  };
  readonly icon: string;
}

export const STREAK_MILESTONES: readonly StreakMilestoneDefinition[] = [
  {
    days: 3,
    xpReward: 15,
    title: { en: "Getting Started", sw: "Kuanza" },
    icon: "local_fire_department",
  },
  {
    days: 7,
    xpReward: 50,
    title: { en: "One Week Strong", sw: "Wiki Moja Imara" },
    icon: "whatshot",
  },
  {
    days: 14,
    xpReward: 100,
    title: { en: "Two Week Warrior", sw: "Shujaa wa Wiki Mbili" },
    icon: "bolt",
  },
  {
    days: 30,
    xpReward: 250,
    title: { en: "Monthly Master", sw: "Bwana wa Mwezi" },
    icon: "military_tech",
  },
  {
    days: 60,
    xpReward: 500,
    title: { en: "Committed Learner", sw: "Mwanafunzi Aliyejitolea" },
    icon: "shield",
  },
  {
    days: 90,
    xpReward: 1000,
    title: { en: "Quarter Champion", sw: "Bingwa wa Robo Mwaka" },
    icon: "emoji_events",
  },
  {
    days: 180,
    xpReward: 2500,
    title: { en: "Half-Year Hero", sw: "Shujaa wa Nusu Mwaka" },
    icon: "workspace_premium",
  },
  {
    days: 365,
    xpReward: 5000,
    title: { en: "Year of Excellence", sw: "Mwaka wa Ubora" },
    icon: "diamond",
  },
] as const;

// ============================================================================
// STREAK MESSAGES
// ============================================================================

interface StreakMessageEntry {
  readonly minDays: number;
  readonly maxDays: number;
  readonly message: {
    readonly en: string;
    readonly sw: string;
  };
}

const STREAK_MESSAGES: readonly StreakMessageEntry[] = [
  {
    minDays: 1,
    maxDays: 2,
    message: {
      en: "You have started a streak! Come back tomorrow to keep it going.",
      sw: "Umeanza mfululizo! Rudi kesho kuendelea.",
    },
  },
  {
    minDays: 3,
    maxDays: 6,
    message: {
      en: "Nice streak! You are building a great habit.",
      sw: "Mfululizo mzuri! Unajenga tabia nzuri.",
    },
  },
  {
    minDays: 7,
    maxDays: 13,
    message: {
      en: "One week and counting! Your consistency is impressive.",
      sw: "Wiki moja na kuendelea! Uthabiti wako unavutia.",
    },
  },
  {
    minDays: 14,
    maxDays: 29,
    message: {
      en: "Two weeks strong! You are truly dedicated to your growth.",
      sw: "Wiki mbili imara! Umejitolea kweli kwa ukuaji wako.",
    },
  },
  {
    minDays: 30,
    maxDays: 59,
    message: {
      en: "A full month! Your discipline sets you apart from the rest.",
      sw: "Mwezi mzima! Nidhamu yako inakutofautisha na wengine.",
    },
  },
  {
    minDays: 60,
    maxDays: 89,
    message: {
      en: "Two months of daily learning. You are in the top 5% of users!",
      sw: "Miezi miwili ya kujifunza kila siku. Uko katika 5% bora ya watumiaji!",
    },
  },
  {
    minDays: 90,
    maxDays: 179,
    message: {
      en: "A quarter year of consistent effort. Remarkable commitment!",
      sw: "Robo mwaka ya jitihada thabiti. Kujitolea kwa ajabu!",
    },
  },
  {
    minDays: 180,
    maxDays: 364,
    message: {
      en: "Half a year! You are an inspiration to every entrepreneur on this platform.",
      sw: "Nusu mwaka! Wewe ni msukumo kwa kila mjasiriamali kwenye jukwaa hili.",
    },
  },
  {
    minDays: 365,
    maxDays: Infinity,
    message: {
      en: "A full year of daily dedication. You are a true legend!",
      sw: "Mwaka mzima wa kujitolea kila siku. Wewe ni hadithi ya kweli!",
    },
  },
] as const;

// ============================================================================
// PURE FUNCTIONS
// ============================================================================

/**
 * Calculate the current streak length from an array of login date strings.
 * Dates should be ISO 8601 strings. The function sorts them and counts
 * consecutive days working backward from the most recent date, using
 * the 36-hour grace period.
 *
 * @param loginDates - Array of ISO date strings representing login timestamps
 * @returns Current streak count in days
 */
export function calculateStreak(loginDates: readonly string[]): number {
  if (loginDates.length === 0) return 0;

  // Create sorted unique dates (by calendar day)
  const uniqueDays = getUniqueSortedDays(loginDates);
  if (uniqueDays.length === 0) return 0;

  // Check if the most recent login is within the grace period of "now"
  const now = Date.now();
  const mostRecent = uniqueDays[uniqueDays.length - 1];
  if (now - mostRecent > GRACE_PERIOD_MS) return 0;

  // Count consecutive days backward from the most recent
  let streak = 1;
  for (let i = uniqueDays.length - 1; i > 0; i--) {
    const gap = uniqueDays[i] - uniqueDays[i - 1];
    if (gap <= GRACE_PERIOD_MS) {
      streak += 1;
    } else {
      break;
    }
  }

  return streak;
}

/**
 * Determine if a streak is currently active based on the last login timestamp.
 * Active means the last login was within the 36-hour grace period.
 *
 * @param lastLogin - ISO date string of the last login
 * @returns Whether the streak is still active
 */
export function isStreakActive(lastLogin: string): boolean {
  const lastLoginTime = new Date(lastLogin).getTime();
  if (isNaN(lastLoginTime)) return false;
  const elapsed = Date.now() - lastLoginTime;
  return elapsed <= GRACE_PERIOD_MS;
}

/**
 * Get the streak reward (milestone definition) for a given number of streak days.
 * Returns the matching milestone if the streak days exactly hit a milestone,
 * or null if no milestone is hit.
 *
 * @param days - Current streak length in days
 * @returns The milestone definition if this is a milestone day, null otherwise
 */
export function getStreakReward(
  days: number,
): StreakMilestoneDefinition | null {
  return STREAK_MILESTONES.find((m) => m.days === days) ?? null;
}

/**
 * Get all milestones that have been achieved for a given streak length.
 *
 * @param days - Current streak length in days
 * @returns Array of achieved milestones
 */
export function getAchievedMilestones(
  days: number,
): readonly StreakMilestoneDefinition[] {
  return STREAK_MILESTONES.filter((m) => days >= m.days);
}

/**
 * Get the next milestone to achieve given current streak days.
 * Returns null if all milestones are achieved.
 *
 * @param days - Current streak length in days
 * @returns The next milestone to aim for, or null
 */
export function getNextMilestone(
  days: number,
): StreakMilestoneDefinition | null {
  return STREAK_MILESTONES.find((m) => m.days > days) ?? null;
}

/**
 * Get a motivational streak message in the requested language.
 *
 * @param days - Current streak length in days
 * @param language - Language code ("en" or "sw")
 * @returns Motivational message string
 */
export function getStreakMessage(days: number, language: "en" | "sw"): string {
  if (days <= 0) {
    return language === "en"
      ? "Start your streak today! Log in daily to build momentum."
      : "Anza mfululizo wako leo! Ingia kila siku kujenga kasi.";
  }

  const entry = STREAK_MESSAGES.find(
    (m) => days >= m.minDays && days <= m.maxDays,
  );

  if (!entry) {
    return language === "en"
      ? `${days}-day streak! Incredible dedication!`
      : `Mfululizo wa siku ${days}! Kujitolea kwa ajabu!`;
  }

  return entry.message[language];
}

/**
 * Calculate the percentage progress toward the next milestone.
 *
 * @param days - Current streak length in days
 * @returns Progress percentage (0-100)
 */
export function getStreakProgressToNextMilestone(days: number): number {
  const next = getNextMilestone(days);
  if (!next) return 100;

  const achieved = getAchievedMilestones(days);
  const previousDays =
    achieved.length > 0 ? achieved[achieved.length - 1].days : 0;

  const totalNeeded = next.days - previousDays;
  const progress = days - previousDays;

  if (totalNeeded <= 0) return 100;
  return Math.min(100, Math.max(0, (progress / totalNeeded) * 100));
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Convert login date strings to unique sorted timestamps (start of day).
 * Internal helper, not exported.
 */
function getUniqueSortedDays(dates: readonly string[]): readonly number[] {
  const daySet = new Set<string>();
  const timestamps: number[] = [];

  for (const dateStr of dates) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) continue;
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!daySet.has(dayKey)) {
      daySet.add(dayKey);
      // Use start of day for consistent comparison
      const startOfDay = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
      ).getTime();
      timestamps.push(startOfDay);
    }
  }

  return [...timestamps].sort((a, b) => a - b);
}

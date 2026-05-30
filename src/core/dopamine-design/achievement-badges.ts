/**
 * Achievement Badges
 *
 * Comprehensive badge/achievement definitions for the Borjie platform.
 * Each badge has bilingual names and descriptions, rarity tiers,
 * visual icons, criteria definitions, and XP rewards.
 *
 * Categories: learning, readiness, engagement, completion, mastery
 * Rarities: common, rare, epic, legendary
 *
 * All data structures are readonly/immutable.
 * All functions are pure with no side effects.
 *
 * @module core/dopamine-design/achievement-badges
 */

// ============================================================================
// TYPES
// ============================================================================

export type BadgeRarity = "common" | "rare" | "epic" | "legendary";

export type BadgeCategory =
  | "learning"
  | "readiness"
  | "engagement"
  | "completion"
  | "mastery";

export interface BadgeCriteria {
  readonly type: string;
  readonly threshold: number;
  readonly description: {
    readonly en: string;
    readonly sw: string;
  };
}

export interface AchievementBadge {
  readonly id: string;
  readonly name: {
    readonly en: string;
    readonly sw: string;
  };
  readonly description: {
    readonly en: string;
    readonly sw: string;
  };
  readonly icon: string;
  readonly rarity: BadgeRarity;
  readonly category: BadgeCategory;
  readonly criteria: BadgeCriteria;
  readonly xpReward: number;
  readonly gradient: string;
}

// ============================================================================
// USER STATS INTERFACE (for eligibility checking)
// ============================================================================

export interface UserStats {
  readonly quizzesCompleted: number;
  readonly quizzesPerfect: number;
  readonly conceptsMastered: number;
  readonly modulesCompleted: number;
  readonly streakDays: number;
  readonly totalXP: number;
  readonly documentsUploaded: number;
  readonly formsCompleted: number;
  readonly loansSubmitted: number;
  readonly brsScore: number;
  readonly loginDays: number;
  readonly certificatesEarned: number;
  readonly fiveCsCompleted: number;
  readonly businessPlansCreated: number;
  readonly riskAssessmentsCompleted: number;
  readonly classroomSessionsCompleted: number;
  readonly peersHelped: number;
}

// ============================================================================
// RARITY VISUAL CONFIG
// ============================================================================

export const RARITY_CONFIG: Readonly<
  Record<
    BadgeRarity,
    {
      readonly borderColor: string;
      readonly glowColor: string;
      readonly bgGradient: string;
      readonly label: { readonly en: string; readonly sw: string };
    }
  >
> = {
  common: {
    borderColor: "border-slate-400",
    glowColor: "shadow-slate-400/30",
    bgGradient: "from-slate-100 to-slate-200",
    label: { en: "Common", sw: "Kawaida" },
  },
  rare: {
    borderColor: "border-blue-500",
    glowColor: "shadow-blue-500/40",
    bgGradient: "from-blue-100 to-blue-200",
    label: { en: "Rare", sw: "Nadra" },
  },
  epic: {
    borderColor: "border-primary",
    glowColor: "shadow-primary/50",
    bgGradient: "from-primary to-primary",
    label: { en: "Epic", sw: "Bora Sana" },
  },
  legendary: {
    borderColor: "border-amber-500",
    glowColor: "shadow-amber-500/60",
    bgGradient: "from-amber-100 to-amber-200",
    label: { en: "Legendary", sw: "Hadithi" },
  },
} as const;

// ============================================================================
// ACHIEVEMENT BADGES
// ============================================================================

export const ACHIEVEMENT_BADGES: readonly AchievementBadge[] = [
  // ---- LEARNING CATEGORY ----
  {
    id: "first_quiz",
    name: { en: "First Quiz", sw: "Mtihani wa Kwanza" },
    description: {
      en: "Complete your very first quiz on the platform.",
      sw: "Kamilisha mtihani wako wa kwanza kabisa kwenye jukwaa.",
    },
    icon: "quiz",
    rarity: "common",
    category: "learning",
    criteria: {
      type: "quizzesCompleted",
      threshold: 1,
      description: { en: "Complete 1 quiz", sw: "Kamilisha mtihani 1" },
    },
    xpReward: 10,
    gradient: "from-green-400 to-emerald-500",
  },
  {
    id: "quiz_enthusiast",
    name: { en: "Quiz Enthusiast", sw: "Mpenzi wa Mitihani" },
    description: {
      en: "Complete 25 quizzes. You truly love learning!",
      sw: "Kamilisha mitihani 25. Unapenda kujifunza kweli!",
    },
    icon: "psychology",
    rarity: "rare",
    category: "learning",
    criteria: {
      type: "quizzesCompleted",
      threshold: 25,
      description: { en: "Complete 25 quizzes", sw: "Kamilisha mitihani 25" },
    },
    xpReward: 75,
    gradient: "from-blue-400 to-primary",
  },
  {
    id: "perfect_score",
    name: { en: "Perfect Score", sw: "Alama Kamili" },
    description: {
      en: "Score 100% on any quiz. Flawless performance!",
      sw: "Pata 100% kwenye mtihani wowote. Utendaji bila kasoro!",
    },
    icon: "stars",
    rarity: "rare",
    category: "learning",
    criteria: {
      type: "quizzesPerfect",
      threshold: 1,
      description: {
        en: "Get 1 perfect quiz score",
        sw: "Pata alama kamili 1",
      },
    },
    xpReward: 25,
    gradient: "from-yellow-400 to-amber-500",
  },
  {
    id: "perfectionist",
    name: { en: "The Perfectionist", sw: "Mkamilifu" },
    description: {
      en: "Achieve 10 perfect quiz scores. Precision is your trademark.",
      sw: "Pata alama kamili 10. Usahihi ni alama yako.",
    },
    icon: "diamond",
    rarity: "epic",
    category: "learning",
    criteria: {
      type: "quizzesPerfect",
      threshold: 10,
      description: { en: "Get 10 perfect scores", sw: "Pata alama kamili 10" },
    },
    xpReward: 150,
    gradient: "from-primary to-primary",
  },
  {
    id: "first_concept",
    name: { en: "First Concept", sw: "Dhana ya Kwanza" },
    description: {
      en: "Master your first learning concept.",
      sw: "Elewa dhana yako ya kwanza ya kujifunza.",
    },
    icon: "lightbulb",
    rarity: "common",
    category: "learning",
    criteria: {
      type: "conceptsMastered",
      threshold: 1,
      description: { en: "Master 1 concept", sw: "Elewa dhana 1" },
    },
    xpReward: 15,
    gradient: "from-cyan-400 to-blue-500",
  },

  // ---- READINESS CATEGORY ----
  {
    id: "credit_ready",
    name: { en: "Credit Ready", sw: "Tayari kwa Mkopo" },
    description: {
      en: "Reach a BRS score of 50. You are halfway to full readiness!",
      sw: "Fikia alama ya BRS ya 50. Uko nusu ya njia ya utayari kamili!",
    },
    icon: "trending_up",
    rarity: "rare",
    category: "readiness",
    criteria: {
      type: "brsScore",
      threshold: 50,
      description: { en: "Reach BRS 50", sw: "Fikia BRS 50" },
    },
    xpReward: 100,
    gradient: "from-teal-400 to-cyan-500",
  },
  {
    id: "fully_ready",
    name: { en: "Fully Ready", sw: "Tayari Kabisa" },
    description: {
      en: "Reach a BRS score of 80. You are fully prepared for credit!",
      sw: "Fikia alama ya BRS ya 80. Umetayarishwa kabisa kwa mkopo!",
    },
    icon: "verified",
    rarity: "epic",
    category: "readiness",
    criteria: {
      type: "brsScore",
      threshold: 80,
      description: { en: "Reach BRS 80", sw: "Fikia BRS 80" },
    },
    xpReward: 250,
    gradient: "from-emerald-400 to-green-600",
  },
  {
    id: "five_cs_master",
    name: { en: "5Cs Master", sw: "Bwana wa 5Cs" },
    description: {
      en: "Complete all five credit dimensions: Character, Capacity, Capital, Collateral, Conditions.",
      sw: "Kamilisha vipimo vyote vitano vya mkopo: Tabia, Uwezo, Mtaji, Dhamana, Masharti.",
    },
    icon: "workspace_premium",
    rarity: "epic",
    category: "readiness",
    criteria: {
      type: "fiveCsCompleted",
      threshold: 5,
      description: { en: "Complete all 5Cs", sw: "Kamilisha 5Cs zote" },
    },
    xpReward: 200,
    gradient: "from-primary to-primary",
  },
  {
    id: "risk_manager",
    name: { en: "Risk Manager", sw: "Meneja wa Hatari" },
    description: {
      en: "Complete 5 risk assessments. You understand risk inside and out.",
      sw: "Kamilisha tathmini 5 za hatari. Unaelewa hatari ndani na nje.",
    },
    icon: "shield",
    rarity: "rare",
    category: "readiness",
    criteria: {
      type: "riskAssessmentsCompleted",
      threshold: 5,
      description: {
        en: "Complete 5 risk assessments",
        sw: "Kamilisha tathmini 5 za hatari",
      },
    },
    xpReward: 75,
    gradient: "from-red-400 to-rose-500",
  },

  // ---- ENGAGEMENT CATEGORY ----
  {
    id: "streak_3",
    name: { en: "Getting Started", sw: "Kuanza" },
    description: {
      en: "Maintain a 3-day login streak. Consistency begins here!",
      sw: "Dumisha mfululizo wa kuingia kwa siku 3. Uthabiti unaanza hapa!",
    },
    icon: "local_fire_department",
    rarity: "common",
    category: "engagement",
    criteria: {
      type: "streakDays",
      threshold: 3,
      description: { en: "3-day streak", sw: "Mfululizo wa siku 3" },
    },
    xpReward: 15,
    gradient: "from-orange-400 to-amber-500",
  },
  {
    id: "streak_7",
    name: { en: "Week Warrior", sw: "Shujaa wa Wiki" },
    description: {
      en: "Maintain a 7-day login streak. A full week of dedication!",
      sw: "Dumisha mfululizo wa kuingia kwa siku 7. Wiki nzima ya kujitolea!",
    },
    icon: "whatshot",
    rarity: "rare",
    category: "engagement",
    criteria: {
      type: "streakDays",
      threshold: 7,
      description: { en: "7-day streak", sw: "Mfululizo wa siku 7" },
    },
    xpReward: 50,
    gradient: "from-orange-500 to-red-500",
  },
  {
    id: "streak_30",
    name: { en: "Monthly Dedication", sw: "Kujitolea kwa Mwezi" },
    description: {
      en: "Maintain a 30-day login streak. A month of pure commitment!",
      sw: "Dumisha mfululizo wa kuingia kwa siku 30. Mwezi wa kujitolea!",
    },
    icon: "military_tech",
    rarity: "epic",
    category: "engagement",
    criteria: {
      type: "streakDays",
      threshold: 30,
      description: { en: "30-day streak", sw: "Mfululizo wa siku 30" },
    },
    xpReward: 250,
    gradient: "from-red-500 to-pink-600",
  },
  {
    id: "streak_365",
    name: { en: "Year of Excellence", sw: "Mwaka wa Ubora" },
    description: {
      en: "Maintain a 365-day login streak. An entire year. You are legendary!",
      sw: "Dumisha mfululizo wa siku 365. Mwaka mzima. Wewe ni hadithi!",
    },
    icon: "diamond",
    rarity: "legendary",
    category: "engagement",
    criteria: {
      type: "streakDays",
      threshold: 365,
      description: { en: "365-day streak", sw: "Mfululizo wa siku 365" },
    },
    xpReward: 5000,
    gradient: "from-amber-400 to-yellow-300",
  },
  {
    id: "community_helper",
    name: { en: "Community Helper", sw: "Msaidizi wa Jamii" },
    description: {
      en: "Help 10 peers with their learning journey.",
      sw: "Saidia wenzako 10 katika safari yao ya kujifunza.",
    },
    icon: "groups",
    rarity: "rare",
    category: "engagement",
    criteria: {
      type: "peersHelped",
      threshold: 10,
      description: { en: "Help 10 peers", sw: "Saidia wenzako 10" },
    },
    xpReward: 100,
    gradient: "from-pink-400 to-rose-500",
  },
  {
    id: "classroom_graduate",
    name: { en: "Classroom Graduate", sw: "Mhitimu wa Darasa" },
    description: {
      en: "Complete 5 group classroom sessions.",
      sw: "Kamilisha vipindi 5 vya darasa la kikundi.",
    },
    icon: "school",
    rarity: "rare",
    category: "engagement",
    criteria: {
      type: "classroomSessionsCompleted",
      threshold: 5,
      description: {
        en: "Complete 5 classroom sessions",
        sw: "Kamilisha vipindi 5 vya darasa",
      },
    },
    xpReward: 75,
    gradient: "from-primary to-primary",
  },

  // ---- COMPLETION CATEGORY ----
  {
    id: "document_pro",
    name: { en: "Document Pro", sw: "Mtaalamu wa Nyaraka" },
    description: {
      en: "Upload 10 documents. Your file game is strong!",
      sw: "Pakia nyaraka 10. Mchezo wako wa faili ni imara!",
    },
    icon: "folder_open",
    rarity: "common",
    category: "completion",
    criteria: {
      type: "documentsUploaded",
      threshold: 10,
      description: { en: "Upload 10 documents", sw: "Pakia nyaraka 10" },
    },
    xpReward: 30,
    gradient: "from-slate-400 to-zinc-500",
  },
  {
    id: "business_planner",
    name: { en: "Business Planner", sw: "Mpangaji wa Biashara" },
    description: {
      en: "Create your first business plan. The foundation of your venture!",
      sw: "Unda mpango wako wa kwanza wa biashara. Msingi wa mradi wako!",
    },
    icon: "description",
    rarity: "rare",
    category: "completion",
    criteria: {
      type: "businessPlansCreated",
      threshold: 1,
      description: {
        en: "Create 1 business plan",
        sw: "Unda mpango 1 wa biashara",
      },
    },
    xpReward: 50,
    gradient: "from-sky-400 to-blue-500",
  },
  {
    id: "first_application",
    name: { en: "First Application", sw: "Maombi ya Kwanza" },
    description: {
      en: "Submit your first credit application. A bold step forward!",
      sw: "Wasilisha maombi yako ya kwanza ya mkopo. Hatua ya ujasiri!",
    },
    icon: "send",
    rarity: "rare",
    category: "completion",
    criteria: {
      type: "loansSubmitted",
      threshold: 1,
      description: { en: "Submit 1 application", sw: "Wasilisha maombi 1" },
    },
    xpReward: 100,
    gradient: "from-emerald-400 to-teal-500",
  },
  {
    id: "form_master",
    name: { en: "Form Master", sw: "Bwana wa Fomu" },
    description: {
      en: "Complete 20 form sections across the platform.",
      sw: "Kamilisha sehemu 20 za fomu kwenye jukwaa.",
    },
    icon: "checklist",
    rarity: "common",
    category: "completion",
    criteria: {
      type: "formsCompleted",
      threshold: 20,
      description: {
        en: "Complete 20 form sections",
        sw: "Kamilisha sehemu 20 za fomu",
      },
    },
    xpReward: 40,
    gradient: "from-lime-400 to-green-500",
  },

  // ---- MASTERY CATEGORY ----
  {
    id: "master_of_finance",
    name: { en: "Master of Finance", sw: "Bwana wa Fedha" },
    description: {
      en: "Master 10 financial concepts. Your understanding runs deep!",
      sw: "Elewa dhana 10 za fedha. Uelewa wako ni wa kina!",
    },
    icon: "account_balance",
    rarity: "epic",
    category: "mastery",
    criteria: {
      type: "conceptsMastered",
      threshold: 10,
      description: { en: "Master 10 concepts", sw: "Elewa dhana 10" },
    },
    xpReward: 200,
    gradient: "from-primary to-primary",
  },
  {
    id: "knowledge_sage",
    name: { en: "Knowledge Sage", sw: "Mwenye Hekima" },
    description: {
      en: "Master 25 concepts across all domains. True wisdom!",
      sw: "Elewa dhana 25 katika nyanja zote. Hekima ya kweli!",
    },
    icon: "auto_awesome",
    rarity: "legendary",
    category: "mastery",
    criteria: {
      type: "conceptsMastered",
      threshold: 25,
      description: { en: "Master 25 concepts", sw: "Elewa dhana 25" },
    },
    xpReward: 500,
    gradient: "from-amber-400 to-orange-500",
  },
  {
    id: "certified_professional",
    name: { en: "Certified Professional", sw: "Mtaalamu Aliyeidhinishwa" },
    description: {
      en: "Earn 3 certificates from learning programs.",
      sw: "Pata vyeti 3 kutoka programu za kujifunza.",
    },
    icon: "workspace_premium",
    rarity: "epic",
    category: "mastery",
    criteria: {
      type: "certificatesEarned",
      threshold: 3,
      description: { en: "Earn 3 certificates", sw: "Pata vyeti 3" },
    },
    xpReward: 300,
    gradient: "from-primary to-pink-600",
  },
  {
    id: "xp_legend",
    name: { en: "XP Legend", sw: "Hadithi ya XP" },
    description: {
      en: "Accumulate 10,000 XP. You have reached the pinnacle!",
      sw: "Kusanya XP 10,000. Umefika kileleni!",
    },
    icon: "emoji_events",
    rarity: "legendary",
    category: "mastery",
    criteria: {
      type: "totalXP",
      threshold: 10000,
      description: { en: "Earn 10,000 XP", sw: "Pata XP 10,000" },
    },
    xpReward: 1000,
    gradient: "from-yellow-300 to-amber-400",
  },
] as const;

// ============================================================================
// PURE FUNCTIONS
// ============================================================================

/**
 * Check if a user is eligible for a specific badge based on their stats.
 * Pure function that compares badge criteria against user statistics.
 *
 * @param badge - The badge to check eligibility for
 * @param userStats - The user's current statistics
 * @returns Whether the user meets the badge criteria
 */
export function checkBadgeEligibility(
  badge: AchievementBadge,
  userStats: UserStats,
): boolean {
  const { type, threshold } = badge.criteria;
  const statValue = userStats[type as keyof UserStats];

  if (typeof statValue !== "number") return false;
  return statValue >= threshold;
}

/**
 * Get all badges a user is eligible for based on their stats.
 *
 * @param userStats - The user's current statistics
 * @returns Array of badges the user qualifies for
 */
export function getEligibleBadges(
  userStats: UserStats,
): readonly AchievementBadge[] {
  return ACHIEVEMENT_BADGES.filter((badge) =>
    checkBadgeEligibility(badge, userStats),
  );
}

/**
 * Get all badges in a specific category.
 *
 * @param category - Badge category to filter by
 * @returns Array of badges in the category
 */
export function getBadgesByCategory(
  category: BadgeCategory,
): readonly AchievementBadge[] {
  return ACHIEVEMENT_BADGES.filter((badge) => badge.category === category);
}

/**
 * Get all badges of a specific rarity.
 *
 * @param rarity - Badge rarity to filter by
 * @returns Array of badges with the specified rarity
 */
export function getBadgesByRarity(
  rarity: BadgeRarity,
): readonly AchievementBadge[] {
  return ACHIEVEMENT_BADGES.filter((badge) => badge.rarity === rarity);
}

/**
 * Find a badge by its ID.
 *
 * @param id - The badge ID to look up
 * @returns The badge definition, or null if not found
 */
export function getBadgeById(id: string): AchievementBadge | null {
  return ACHIEVEMENT_BADGES.find((badge) => badge.id === id) ?? null;
}

/**
 * Get newly earned badges by comparing previous and current stats.
 * Returns only badges that were NOT earned before but ARE earned now.
 *
 * @param previousStats - Stats before the action
 * @param currentStats - Stats after the action
 * @returns Array of newly earned badges
 */
export function getNewlyEarnedBadges(
  previousStats: UserStats,
  currentStats: UserStats,
): readonly AchievementBadge[] {
  const previouslyEarned = new Set(
    getEligibleBadges(previousStats).map((b) => b.id),
  );
  return getEligibleBadges(currentStats).filter(
    (badge) => !previouslyEarned.has(badge.id),
  );
}

/**
 * Calculate the total XP reward from all earned badges.
 *
 * @param earnedBadgeIds - Set of badge IDs the user has earned
 * @returns Total XP from badge rewards
 */
export function calculateBadgeXPTotal(
  earnedBadgeIds: ReadonlySet<string>,
): number {
  return ACHIEVEMENT_BADGES.filter((b) => earnedBadgeIds.has(b.id)).reduce(
    (total, badge) => total + badge.xpReward,
    0,
  );
}

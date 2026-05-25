/**
 * Dopamine Design shared types.
 */

export type DopamineTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface AchievementBadgeData {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly titleEn: string;
  readonly titleSw: string;
  readonly descriptionEn: string;
  readonly descriptionSw: string;
  readonly tier: DopamineTier;
  readonly earnedAt: string | null;
  readonly iconKey: string;
}

export interface StreakState {
  readonly tenantId: string;
  readonly userId: string;
  readonly streakKey: string;
  readonly currentValue: number;
  readonly lastIncrementAt: string;
  readonly personalBest: number;
}

export interface LevelState {
  readonly tenantId: string;
  readonly userId: string;
  readonly xp: number;
  readonly tier: DopamineTier;
  readonly xpToNextTier: number;
}

export type CelebrationTrigger =
  | 'tenant-signed-lease'
  | 'tenant-on-time-payment'
  | 'maintenance-case-resolved'
  | 'arrears-case-cleared'
  | 'tender-awarded'
  | 'perfect-inspection';

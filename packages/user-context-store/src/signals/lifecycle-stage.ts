/**
 * Lifecycle-stage derivation.
 *
 * Pure function. Maps profile + activity + payment signals to a
 * {@link LifecycleStage} enum value. Boundary thresholds are tuned for
 * property-management lifecycles (move-in → steady → exit). Keep IO out.
 */
import type {
  AnyProfile,
  LifecycleStage,
  PaymentMonth,
  RecentActivity,
  TenantProfile,
} from '../types.js';

export interface LifecycleStageArgs {
  readonly profile: AnyProfile;
  readonly activity: RecentActivity;
  readonly payments?: ReadonlyArray<PaymentMonth>;
}

function isTenantProfile(p: AnyProfile): p is TenantProfile {
  return 'currentLease' in p || 'paymentHistory24m' in p;
}

/**
 * Derive {@link LifecycleStage} from observed signals.
 *
 * Heuristics:
 *   - `churned` if no activity in 90+ days AND no active lease
 *   - `reactivating` if activity exists in 14 days AND prior gap was >60 days
 *   - `at_risk` if any payment 14+ days late in last 3 months
 *   - `onboarding` if user is <30 days old OR first lease is <60 days old
 *   - default `active`
 */
export function lifecycleStage(args: LifecycleStageArgs): LifecycleStage {
  const now = Date.now();
  const lastInteraction = args.activity.lastInteractionAt
    ? Date.parse(args.activity.lastInteractionAt)
    : null;
  const daysSinceLastInteraction =
    lastInteraction !== null
      ? Math.floor((now - lastInteraction) / (1000 * 60 * 60 * 24))
      : null;

  // Churned: long-quiet AND lease ended.
  if (daysSinceLastInteraction !== null && daysSinceLastInteraction >= 90) {
    if (isTenantProfile(args.profile)) {
      const lease = args.profile.currentLease;
      const leaseEnded =
        !lease ||
        (lease.endDate &&
          Date.parse(lease.endDate) < now &&
          lease.status !== 'active');
      if (leaseEnded) return 'churned';
    } else {
      return 'churned';
    }
  }

  // At-risk: any payment 14+ days late in last 3 months.
  const payments =
    args.payments ??
    (isTenantProfile(args.profile) ? args.profile.paymentHistory24m : undefined);
  if (payments && payments.length > 0) {
    const recent = payments.slice(0, 3);
    const anyLate = recent.some(
      (m) => (m.daysLate ?? 0) >= 14 || m.balance > 0,
    );
    if (anyLate) return 'at_risk';
  }

  // Reactivating: active in last 14d, but no activity for >60d before.
  if (daysSinceLastInteraction !== null && daysSinceLastInteraction <= 14) {
    const activeWindow = args.activity.loginCount + args.activity.pagesViewed;
    if (
      activeWindow > 0 &&
      args.activity.windowDays >= 14 &&
      args.activity.windowDays <= 30
    ) {
      // Heuristic: low total interactions over a wide window suggests reactivation
      if (activeWindow <= 3) return 'reactivating';
    }
  }

  // Onboarding: very fresh lease.
  if (isTenantProfile(args.profile)) {
    const lease = args.profile.currentLease;
    if (lease?.startDate) {
      const leaseAgeDays = Math.floor(
        (now - Date.parse(lease.startDate)) / (1000 * 60 * 60 * 24),
      );
      if (leaseAgeDays >= 0 && leaseAgeDays <= 60) return 'onboarding';
    }
  }

  return 'active';
}

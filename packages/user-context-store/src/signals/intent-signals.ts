/**
 * Intent-signal derivation.
 *
 * Pure function. Inspects recent activity, lifecycle, and profile shape
 * to surface hints about what the user is about to do. The output is
 * a non-exhaustive `IntentSignal[]` — the advisor uses these to set
 * its conversational stance (proactive vs reactive).
 */
import type {
  AnyProfile,
  IntentSignal,
  LifecycleStage,
  RecentActivity,
  TenantProfile,
} from '../types.js';

export interface IntentSignalsArgs {
  readonly activity: RecentActivity;
  readonly lifecycle: LifecycleStage;
  readonly profile: AnyProfile;
}

function isTenantProfile(p: AnyProfile): p is TenantProfile {
  return 'currentLease' in p || 'paymentHistory24m' in p;
}

const FEATURE_INTENT_MAP: ReadonlyArray<{
  feature: string;
  kind: string;
}> = [
  { feature: 'page.lease', kind: 'lease.review' },
  { feature: 'page.payments', kind: 'payment.review' },
  { feature: 'page.maintenance', kind: 'maintenance.submit' },
  { feature: 'page.documents', kind: 'document.access' },
  { feature: 'page.search', kind: 'unit.search' },
  { feature: 'tool.calendar', kind: 'inspection.schedule' },
  { feature: 'page.renewal', kind: 'lease.renewal' },
  { feature: 'page.move_out', kind: 'lease.exit' },
];

/**
 * Derive intent signals from observed signals + profile.
 */
export function intentSignals(args: IntentSignalsArgs): ReadonlyArray<IntentSignal> {
  const out: IntentSignal[] = [];
  const featureSet = new Set(args.activity.featuresTouched);

  for (const { feature, kind } of FEATURE_INTENT_MAP) {
    if (featureSet.has(feature)) {
      out.push({
        kind,
        confidence: 0.6,
        evidence: `User touched ${feature} in last ${args.activity.windowDays}d`,
      });
    }
  }

  if (args.activity.searchQueries.length >= 3) {
    out.push({
      kind: 'search.active',
      confidence: 0.75,
      evidence: `${args.activity.searchQueries.length} searches in window`,
    });
  }

  if (args.lifecycle === 'at_risk') {
    out.push({
      kind: 'churn.risk',
      confidence: 0.8,
      evidence: 'Lifecycle stage is at_risk (late payments or low engagement)',
    });
  }

  if (args.lifecycle === 'onboarding') {
    out.push({
      kind: 'onboarding.guide',
      confidence: 0.7,
      evidence: 'User is in the first 60 days of their lease',
    });
  }

  if (args.lifecycle === 'reactivating') {
    out.push({
      kind: 'reactivation',
      confidence: 0.6,
      evidence: 'User returned after a 60+ day quiet period',
    });
  }

  if (isTenantProfile(args.profile)) {
    const lease = args.profile.currentLease;
    if (lease?.endDate) {
      const daysToEnd = Math.floor(
        (Date.parse(lease.endDate) - Date.now()) / (1000 * 60 * 60 * 24),
      );
      if (daysToEnd >= 0 && daysToEnd <= 90) {
        out.push({
          kind: 'lease.decision_window',
          confidence: 0.85,
          evidence: `Lease ends in ${daysToEnd} day(s) — renewal/exit decision window`,
        });
      }
    }
    const openMx = args.profile.openMaintenance ?? [];
    if (openMx.length >= 1) {
      out.push({
        kind: 'maintenance.followup',
        confidence: 0.65,
        evidence: `${openMx.length} open maintenance request(s)`,
      });
    }
  }

  return out;
}

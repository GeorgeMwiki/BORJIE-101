/**
 * Heartbeat duty registry — Wave 27 (Part B.8 amplification).
 *
 * Ships a catalogue of 20 proactive duties that amplify the 5 baked-in
 * housekeeping duties in `heartbeat-engine.ts`. Each duty is a thin
 * factory: the composition root injects the concrete worker (a scan,
 * a sweep, an advisor call) and the factory produces a
 * `HeartbeatDuty` the engine can schedule.
 *
 * Three cadence tiers (per phM blueprint):
 *   - fast   (5  s) — health + urgent escalations
 *   - medium (1  m) — SLA watchdogs, short-window nudges
 *   - slow   (5  m) — scans, briefings, recomputes
 *
 * Duty catalogue (see phM Part B.8 for rationale):
 *   H1  — arrears proactive scan                   (slow)
 *   H2  — renewal window sweep                     (slow)
 *   H3  — rent repricing scan                      (slow)
 *   H4  — property-grade recompute (nightly fallback) (slow)
 *   H5  — credit-rating recompute watchdog         (slow)
 *   H6  — vacancy pipeline nudge                   (slow)
 *   H7  — vendor SLA watchdog                      (medium)
 *   H8  — churn risk sweep                         (slow)
 *   H9  — compliance licence expiry                (slow)
 *   H10 — market intelligence refresh              (medium)
 *   H11 — owner briefing generator                 (slow)
 *   H12 — maintenance preventive cron              (slow)
 *   H13 — anomaly detector                         (fast)
 *   H14 — proactive tenant outreach                (slow)
 *   H15 — policy simulator                         (slow)
 *   H16 — legal deadline tracker                   (slow)
 *   H17 — dispute early-warning                    (slow)
 *   H18 — insurance claim readiness (on demand)    (medium)
 *   H19 — utility reading anomaly                  (slow)
 *   H20 — budget-vs-actual tracking                (slow)
 *
 * Additional from phM that overlap with risk-recompute wiring:
 *   H21 — cost-ledger burn-rate budget warning     (medium)
 *   H22 — stale approval request nudge             (medium)
 *   H23 — tenant presence / re-engagement          (fast)
 */

import type { HeartbeatDuty } from './heartbeat-engine.js';

/**
 * Worker contract every duty factory satisfies. The composition root
 * supplies a bound implementation; the factory wraps it as a
 * `HeartbeatDuty` with the canonical id and cadence.
 *
 * All workers are `async () => Promise<void>`. Any exception is caught
 * by the engine — duty workers must not crash the tick.
 */
export type DutyWorker = (ctx: {
  readonly tickAt: number;
  readonly activeTenantIds: readonly string[];
}) => Promise<void>;

export interface DutyFactoryInput {
  readonly worker: DutyWorker;
  readonly enabled?: boolean;
  readonly cadenceMs?: number;
}

/** Factory helper — keeps `id` + default cadence pinned. */
function duty(
  id: string,
  cadence: 'fast' | 'medium' | 'slow',
  description: string,
  input: DutyFactoryInput,
): HeartbeatDuty {
  return {
    id,
    cadence,
    description,
    enabled: input.enabled !== false,
    cadenceMs: input.cadenceMs,
    async run(ctx) {
      await input.worker({
        tickAt: ctx.tickAt,
        activeTenantIds: ctx.activeTenantIds,
      });
    },
  };
}

export const HEARTBEAT_DUTY_IDS = {
  arrearsProactiveScan: 'H1_arrears_proactive_scan',
  renewalWindowSweep: 'H2_renewal_window_sweep',
  rentRepricingScan: 'H3_rent_repricing_scan',
  propertyGradeRecompute: 'H4_property_grade_recompute',
  creditRatingRecomputeWatchdog: 'H5_credit_rating_recompute_watchdog',
  vacancyPipelineNudge: 'H6_vacancy_pipeline_nudge',
  vendorSlaWatchdog: 'H7_vendor_sla_watchdog',
  churnRiskSweep: 'H8_churn_risk_sweep',
  complianceLicenceExpiry: 'H9_compliance_licence_expiry',
  marketIntelligenceRefresh: 'H10_market_intelligence_refresh',
  ownerBriefingGenerator: 'H11_owner_briefing_generator',
  maintenancePreventiveCron: 'H12_maintenance_preventive_cron',
  anomalyDetector: 'H13_anomaly_detector',
  proactiveTenantOutreach: 'H14_proactive_tenant_outreach',
  policySimulator: 'H15_policy_simulator',
  legalDeadlineTracker: 'H16_legal_deadline_tracker',
  disputeEarlyWarning: 'H17_dispute_early_warning',
  insuranceClaimReadiness: 'H18_insurance_claim_readiness',
  utilityReadingAnomaly: 'H19_utility_reading_anomaly',
  budgetVsActualTracking: 'H20_budget_vs_actual_tracking',
  costLedgerBurnRate: 'H21_cost_ledger_burn_rate',
  staleApprovalNudge: 'H22_stale_approval_nudge',
  tenantPresenceReengagement: 'H23_tenant_presence_reengagement',
} as const;

export type HeartbeatDutyKey = keyof typeof HEARTBEAT_DUTY_IDS;

/**
 * Inject workers keyed by duty-key; returns an array of duties the
 * heartbeat engine can consume. Missing workers are skipped silently
 * so a partial deployment is safe.
 */
export interface HeartbeatDutyRegistryInput {
  readonly workers: Partial<Record<HeartbeatDutyKey, DutyWorker>>;
  readonly disabled?: readonly HeartbeatDutyKey[];
}

export function buildHeartbeatDutyRegistry(
  input: HeartbeatDutyRegistryInput,
): readonly HeartbeatDuty[] {
  const disabledSet = new Set(input.disabled ?? []);
  const out: HeartbeatDuty[] = [];

  const map: ReadonlyArray<{
    readonly key: HeartbeatDutyKey;
    readonly id: string;
    readonly cadence: 'fast' | 'medium' | 'slow';
    readonly description: string;
  }> = [
    {
      key: 'arrearsProactiveScan',
      id: HEARTBEAT_DUTY_IDS.arrearsProactiveScan,
      cadence: 'slow',
      description: 'Daily: find tenants crossing arrears day-5/10/20 buckets and draft reminder sends.',
    },
    {
      key: 'renewalWindowSweep',
      id: HEARTBEAT_DUTY_IDS.renewalWindowSweep,
      cadence: 'slow',
      description: 'Daily: find leases entering 60/30/15-day renewal windows and open renewal conversations.',
    },
    {
      key: 'rentRepricingScan',
      id: HEARTBEAT_DUTY_IDS.rentRepricingScan,
      cadence: 'slow',
      description: 'Nightly: re-run rent-repricing-advisor on every unit; enqueue rent-change proposals.',
    },
    {
      key: 'propertyGradeRecompute',
      id: HEARTBEAT_DUTY_IDS.propertyGradeRecompute,
      cadence: 'slow',
      description: 'Fallback nightly: rerun property-grade snapshots (B.6 event-driven is primary).',
    },
    {
      key: 'creditRatingRecomputeWatchdog',
      id: HEARTBEAT_DUTY_IDS.creditRatingRecomputeWatchdog,
      cadence: 'slow',
      description: 'Fallback: sweep any customer whose rating has not been recomputed in > N hours.',
    },
    {
      key: 'vacancyPipelineNudge',
      id: HEARTBEAT_DUTY_IDS.vacancyPipelineNudge,
      cadence: 'slow',
      description: 'Every 6h: prospect-list stale > 48h → nudge follow-up.',
    },
    {
      key: 'vendorSlaWatchdog',
      id: HEARTBEAT_DUTY_IDS.vendorSlaWatchdog,
      cadence: 'medium',
      description: 'Every 15m: work orders open > SLA → reassign or escalate.',
    },
    {
      key: 'churnRiskSweep',
      id: HEARTBEAT_DUTY_IDS.churnRiskSweep,
      cadence: 'slow',
      description: 'Daily: recompute tenant churn scores; surface top-10.',
    },
    {
      key: 'complianceLicenceExpiry',
      id: HEARTBEAT_DUTY_IDS.complianceLicenceExpiry,
      cadence: 'slow',
      description: 'Daily: parcel-compliance sweep at 90/60/30-day thresholds.',
    },
    {
      key: 'marketIntelligenceRefresh',
      id: HEARTBEAT_DUTY_IDS.marketIntelligenceRefresh,
      cadence: 'medium',
      description: 'Hourly: pull comps for every active market; update market_rent_observations.',
    },
    {
      key: 'ownerBriefingGenerator',
      id: HEARTBEAT_DUTY_IDS.ownerBriefingGenerator,
      cadence: 'slow',
      description: 'Weekly: generate portfolio briefings and schedule delivery.',
    },
    {
      key: 'maintenancePreventiveCron',
      id: HEARTBEAT_DUTY_IDS.maintenancePreventiveCron,
      cadence: 'slow',
      description: 'Daily: preventive-prediction on asset_components; enqueue PM work orders.',
    },
    {
      key: 'anomalyDetector',
      id: HEARTBEAT_DUTY_IDS.anomalyDetector,
      cadence: 'fast',
      description: 'Every tick: watch ledger for abnormal transactions.',
    },
    {
      key: 'proactiveTenantOutreach',
      id: HEARTBEAT_DUTY_IDS.proactiveTenantOutreach,
      cadence: 'slow',
      description: 'Daily: sentiment-monitor finds low-sentiment tenants; draft outreach.',
    },
    {
      key: 'policySimulator',
      id: HEARTBEAT_DUTY_IDS.policySimulator,
      cadence: 'slow',
      description: 'Weekly: run what-if scenarios (+5% rent, +10% maint cap) — show impact.',
    },
    {
      key: 'legalDeadlineTracker',
      id: HEARTBEAT_DUTY_IDS.legalDeadlineTracker,
      cadence: 'slow',
      description: 'Daily: court dates, notice deadlines, statutory cure periods.',
    },
    {
      key: 'disputeEarlyWarning',
      id: HEARTBEAT_DUTY_IDS.disputeEarlyWarning,
      cadence: 'slow',
      description: 'Daily: cluster tenant messages + complaints; surface brewing disputes.',
    },
    {
      key: 'insuranceClaimReadiness',
      id: HEARTBEAT_DUTY_IDS.insuranceClaimReadiness,
      cadence: 'medium',
      description: 'On damage-event: assemble evidence pack, notify broker, open claim case.',
    },
    {
      key: 'utilityReadingAnomaly',
      id: HEARTBEAT_DUTY_IDS.utilityReadingAnomaly,
      cadence: 'slow',
      description: 'Daily: compare meter reads to baseline; detect leaks, solar failures.',
    },
    {
      key: 'budgetVsActualTracking',
      id: HEARTBEAT_DUTY_IDS.budgetVsActualTracking,
      cadence: 'slow',
      description: 'Weekly: alert on category overspend > 20%.',
    },
    {
      key: 'costLedgerBurnRate',
      id: HEARTBEAT_DUTY_IDS.costLedgerBurnRate,
      cadence: 'medium',
      description: 'Every minute: poll cost-ledger burn-rate + emit budget-warning.',
    },
    {
      key: 'staleApprovalNudge',
      id: HEARTBEAT_DUTY_IDS.staleApprovalNudge,
      cadence: 'medium',
      description: 'Every minute: scan unopened approval requests; nudge stale ones.',
    },
    {
      key: 'tenantPresenceReengagement',
      id: HEARTBEAT_DUTY_IDS.tenantPresenceReengagement,
      cadence: 'fast',
      description: 'Fast tick: watch websocket tenant-presence and route re-engagement.',
    },
  ];

  for (const entry of map) {
    const worker = input.workers[entry.key];
    if (!worker) continue;
    if (disabledSet.has(entry.key)) continue;
    out.push(duty(entry.id, entry.cadence, entry.description, { worker }));
  }
  return out;
}

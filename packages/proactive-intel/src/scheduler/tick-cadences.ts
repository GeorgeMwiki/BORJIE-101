/**
 * Tick cadences.
 *
 * Three tiers — `hot` (every 15 min), `warm` (hourly), `cold` (daily).
 * Each cadence carries a list of detector + opportunity *names* (string
 * tags) that the tick-runner resolves against a registry at runtime.
 *
 * Each tick is per-tenant + per-org-internal: the outer scheduler
 * (BullMQ or similar in the orchestrator app) fans out one job per
 * scope. This file declares only the mapping; the runner does the work.
 *
 * Why separate from the runner? Cadence changes are a config decision
 * (e.g. raise cashflow-dip to every 5 min during a payroll week) and
 * should be testable without touching orchestration.
 */
import type { AnomalyKind, OpportunityKind } from '../contracts/events.js';

export type CadenceTier = 'hot' | 'warm' | 'cold';

export interface CadenceSpec {
  readonly tier: CadenceTier;
  readonly intervalMs: number;
  readonly anomalyKinds: ReadonlyArray<AnomalyKind>;
  readonly opportunityKinds: ReadonlyArray<OpportunityKind>;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Hot — every 15 minutes. Only the time-critical detectors.
 *   - cashflow-dip: needs to catch payroll-week shortfalls fast
 *   - cost-anomaly: kills runaway AI spend within one tick
 *   - slo-breach: forecaster MAE drift surfaces here
 */
export const HOT_CADENCE: CadenceSpec = {
  tier: 'hot',
  intervalMs: 15 * MINUTE_MS,
  anomalyKinds: ['cashflow-dip', 'cost-anomaly', 'slo-breach'],
  opportunityKinds: [],
} as const;

/**
 * Warm — hourly. The next tier: trend-watchers that can wait an hour
 * but shouldn't wait a day.
 */
export const WARM_CADENCE: CadenceSpec = {
  tier: 'warm',
  intervalMs: HOUR_MS,
  anomalyKinds: ['arrears-spike', 'vendor-reliability-drop'],
  opportunityKinds: ['vendor-rate-arbitrage'],
} as const;

/**
 * Cold — daily. Slow-moving stuff: churn, compliance deadlines,
 * policy-tightening (which examines a 30d window), rent-vs-market.
 */
export const COLD_CADENCE: CadenceSpec = {
  tier: 'cold',
  intervalMs: DAY_MS,
  anomalyKinds: ['churn-risk', 'compliance-deadline-near'],
  opportunityKinds: ['policy-tightening', 'rent-vs-market'],
} as const;

export const ALL_CADENCES: ReadonlyArray<CadenceSpec> = [
  HOT_CADENCE,
  WARM_CADENCE,
  COLD_CADENCE,
] as const;

export function getCadence(tier: CadenceTier): CadenceSpec {
  switch (tier) {
    case 'hot':
      return HOT_CADENCE;
    case 'warm':
      return WARM_CADENCE;
    case 'cold':
      return COLD_CADENCE;
  }
}

/**
 * @borjie/proactive-intel — public surface (J5 core PR).
 *
 * Phase J5 — Proactive Intelligence Loop, core ship. This PR lands:
 *   - tick scheduler (3 cadence tiers + short runner)
 *   - 3 anomaly detectors (cashflow-dip, arrears-spike, churn-risk)
 *   - recommendation composer (DetectorEvent -> Recommendation)
 *   - fatigue tracker + policy (per-tenant accept/ignore ratchet)
 *
 * DEFERRED to follow-up PRs:
 *   - the other 4 anomaly detectors (cost-anomaly, slo-breach,
 *     compliance-deadline-near, vendor-reliability-drop) — already
 *     scaffolded in detectors/ but not re-exported here yet
 *   - 3 opportunity detectors (vendor-rate-arbitrage,
 *     policy-tightening, rent-vs-market)
 *   - notification adapter (Sierra-style chat-first → WhatsApp → email
 *     digest fallback)
 *
 * The loop (when fully wired):
 *   trigger (outer scheduler) → runTick(ctx, cadence, store)
 *     → detectors return AnomalyEvent[]/OpportunityEvent[]
 *     → composer wraps each as Recommendation (incl. ag-ui part)
 *     → fatigue-policy ratchet decides emit/drop/boost
 *     → notify routes to chat/whatsapp/email-digest per prefs
 *     → owner taps approve → outcome recorded → fatigue learns
 */

// Contracts
export type {
  Entity,
  EntityScope,
  EntityWriteInput,
  EntityQuery,
  EntityStore,
} from './contracts/entity-store.js';
export type {
  AnomalyKind,
  OpportunityKind,
  Confidence,
  Severity,
  AnomalyEvent,
  OpportunityEvent,
  DetectorEvent,
  DetectorEventBase,
} from './contracts/events.js';
export type {
  ForecastBand,
  CashflowForecastSlice,
  ArrearsTimePoint,
  ArrearsSeries,
  CustomerOwnerSignal,
  CostObservation,
  SloObservation,
  ComplianceDeadline,
  ComplianceDeadlineKind,
  VendorOnTimeHistory,
} from './contracts/forecast-input.js';

// Scheduler
export {
  HOT_CADENCE,
  WARM_CADENCE,
  COLD_CADENCE,
  ALL_CADENCES,
  getCadence,
} from './scheduler/tick-cadences.js';
export type { CadenceTier, CadenceSpec } from './scheduler/tick-cadences.js';
export type { TickContext, TickInputs } from './scheduler/tick-context.js';
export { runTick } from './scheduler/tick-runner.js';
export type { TickRunResult } from './scheduler/tick-runner.js';
export {
  ANOMALY_DETECTORS,
  OPPORTUNITY_DETECTORS,
} from './scheduler/detector-registry.js';
export type {
  AnomalyDetectorFn,
  OpportunityDetectorFn,
} from './scheduler/detector-registry.js';

// Core anomaly detectors (3 of 7 wired in this PR)
export { detectCashflowDip } from './detectors/cashflow-dip.detector.js';
export { detectArrearsSpike } from './detectors/arrears-spike.detector.js';
export { detectChurnRisk } from './detectors/churn-risk.detector.js';

// Recommendations
export { compose } from './recommendations/composer.js';
export type {
  Recommendation,
  AnomalyRecommendation,
  OpportunityRecommendation,
  RecommendationBase,
  AgUiApprovalDialogPart,
} from './recommendations/recommendation-types.js';
export { copyForAnomaly, copyForOpportunity } from './recommendations/action-copy.js';
export type { ActionCopy } from './recommendations/action-copy.js';

// Fatigue
export { readHistory, recordOutcome } from './fatigue/fatigue-tracker.js';
export type {
  RecommendationKind,
  Outcome,
  FatigueHistory,
  RecordParams,
} from './fatigue/fatigue-tracker.js';
export { applyFatigue } from './fatigue/fatigue-policy.js';
export type { FatigueDecision } from './fatigue/fatigue-policy.js';

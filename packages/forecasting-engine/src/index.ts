/**
 * @borjie/forecasting-engine — public surface.
 *
 * Simulation + forecasting engine — the MD's imagination. World
 * model, sandbox runtime, time-series + causal + stochastic
 * forecasters, scenario library, multi-objective outcome scoring,
 * and a predicted-vs-actual feedback loop.
 *
 * The closed loop:
 *   simulate(action)            → ranked outcomes + DiffView
 *   record(prediction)          → PredictionStore
 *   on real outcome → delta     → lessonFromDelta + proposeCurveUpdate
 *   curve update → next sim sharper
 */

// Types
export * from './types.js';

// World model
export { WorldModel } from './world-model/world-model.js';
export type { WorldModelState } from './world-model/world-model.js';
export { TenantGraph } from './world-model/tenant-graph.js';
export type { TenantGraphNode } from './world-model/tenant-graph.js';
export { CashflowState } from './world-model/cashflow-state.js';
export type {
  CashflowEvent,
  CashflowStateSnapshot,
} from './world-model/cashflow-state.js';
export { ComplianceState } from './world-model/compliance-state.js';
export type {
  Filing,
  FilingKind,
  ComplianceStateSnapshot,
} from './world-model/compliance-state.js';
export { MarketCache } from './world-model/market-cache.js';
export type { MicroMarketSignals } from './world-model/market-cache.js';
export {
  defaultIntentFor,
  listArchetypes,
} from './world-model/business-archetype.js';

// Sandbox
export { createSandbox, checkHost } from './sandbox/sandbox-runtime.js';
export type {
  CreateSandboxOptions,
  CreateSandboxResult,
} from './sandbox/sandbox-runtime.js';
export { planSchemaClone } from './sandbox/schema-clone.js';
export type { SchemaClonePlan } from './sandbox/schema-clone.js';
export { EphemeralCleanup } from './sandbox/ephemeral-cleanup.js';
export {
  FORBIDDEN_HOSTS,
  FORBIDDEN_DB_TABLES,
  checkTableWrite,
} from './sandbox/isolation-policy.js';
export type { IsolationCheckResult } from './sandbox/isolation-policy.js';

// Time-series forecasters
export {
  fitCashflow,
  forecastCashflow,
  updateCashflow,
} from './forecasters/time-series/cashflow-forecaster.js';
export type {
  HoltWintersParams,
  FitOptions,
} from './forecasters/time-series/cashflow-forecaster.js';
export {
  fitOccupancy,
  forecastOccupancy,
  updateOccupancy,
} from './forecasters/time-series/occupancy-forecaster.js';
export type {
  OccupancyObservation,
  OccupancyParams,
} from './forecasters/time-series/occupancy-forecaster.js';
export {
  fitArrears,
  forecastArrears,
  updateArrears,
} from './forecasters/time-series/arrears-forecaster.js';
export type { LogisticParams } from './forecasters/time-series/arrears-forecaster.js';

// Discrete-event
export { simulateLeaseLifecycle } from './forecasters/discrete-event/lease-lifecycle-sim.js';
export type {
  LeaseEvent,
  LeaseLifecycleInputs,
} from './forecasters/discrete-event/lease-lifecycle-sim.js';
export { simulateMaintenanceQueue } from './forecasters/discrete-event/maintenance-queue-sim.js';
export type {
  MaintenanceQueueInputs,
  MaintenanceQueueResult,
  MaintenanceTicket,
} from './forecasters/discrete-event/maintenance-queue-sim.js';

// Causal
export { createRegistry } from './forecasters/causal/causal-model.js';
export type {
  CausalModel,
  CausalModelMeta,
  CausalModelRegistry,
} from './forecasters/causal/causal-model.js';
export { retentionCurve } from './forecasters/causal/retention-curve.js';
export type {
  RetentionInput,
  RetentionOutput,
} from './forecasters/causal/retention-curve.js';
export { pricingElasticity } from './forecasters/causal/pricing-elasticity.js';
export type {
  PricingInput,
  PricingOutput,
} from './forecasters/causal/pricing-elasticity.js';

// Stochastic
export {
  fitPaymentTiming,
  samplePaymentTimes,
  expectedIntervalMs,
} from './forecasters/stochastic/payment-timing-process.js';
export type {
  PaymentObservation,
  PaymentTimingParams,
} from './forecasters/stochastic/payment-timing-process.js';
export {
  fitNoShow,
  noShowRate,
  sampleNoShow,
} from './forecasters/stochastic/no-show-process.js';
export type {
  NoShowObservation,
  NoShowParams,
} from './forecasters/stochastic/no-show-process.js';
export {
  defaultArrivalParams,
  sampleArrivalsPerDay,
  expectedArrivalsOverHorizon,
} from './forecasters/stochastic/maintenance-arrival-process.js';
export type {
  PropertyClass,
  MaintenanceArrivalParams,
} from './forecasters/stochastic/maintenance-arrival-process.js';

// Scenarios
export type { Scenario, AnyScenario, ScenarioRunContext } from './scenarios/scenario.js';
export { asAnyScenario } from './scenarios/scenario.js';
export { raiseRentScenario } from './scenarios/library/raise-rent.js';
export { acquirePropertyScenario } from './scenarios/library/acquire-property.js';
export { refinanceScenario } from './scenarios/library/refinance.js';
export { fireVendorScenario } from './scenarios/library/fire-vendor.js';
export { waterMainCrisisScenario } from './scenarios/library/water-main-crisis.js';
export { leaseRenewalBatchScenario } from './scenarios/library/lease-renewal-batch.js';
export {
  listScenarios,
  getScenario,
  pickScenarioByText,
} from './scenarios/scenario-builder.js';

// Scoring
export { scoreOutcome, rankByObjective } from './scoring/outcome-scorer.js';
export { paretoFrontier } from './scoring/pareto-frontier.js';
export { intentFor, blendIntents } from './scoring/owner-intent.js';

// Feedback
export {
  computeDelta,
  createPredictionStore,
} from './feedback/predicted-vs-actual.js';
export type { Prediction, PredictionStore } from './feedback/predicted-vs-actual.js';
export { lessonFromDelta } from './feedback/reflexion-update.js';
export { proposeCurveUpdate } from './feedback/world-model-update.js';
export type { CurveUpdateProposal } from './feedback/world-model-update.js';

// Orchestrator
export { simulate } from './orchestrator/simulate.js';
export type { SimulateInputs, AlternativePlan } from './orchestrator/simulate.js';
export { runScenariosParallel } from './orchestrator/parallel-run.js';
export type { ParallelInvocation } from './orchestrator/parallel-run.js';
export { renderDiffView } from './orchestrator/diff-view-renderer.js';

// Util
export { mulberry32, sampleNormal, samplePoisson } from './util/rng.js';

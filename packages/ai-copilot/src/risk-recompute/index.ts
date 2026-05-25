/**
 * Risk-Recompute subtree — Wave 27 (Part B.6).
 *
 * Flips credit-rating / property-grade / vendor-scorecard / churn /
 * tenant-sentiment from scheduled batches to event-driven recomputes.
 *
 * Public surface:
 *   - `createRiskRecomputeDispatcher` — factory for the dispatcher.
 *   - `defaultRiskEventClassifier`    — default event → kind mapping.
 *   - Types for RiskKind, RiskComputeJob, RiskComputeRegistry.
 */

export {
  createRiskRecomputeDispatcher,
  DEFAULT_DEDUPE_WINDOW_MS,
  DEFAULT_SUBSCRIBED_EVENT_TYPES,
} from './dispatcher.js';
export type {
  RiskRecomputeDispatcher,
  RiskRecomputeDispatcherDeps,
  SubscribableEventBus,
} from './dispatcher.js';
export { defaultRiskEventClassifier } from './default-classifier.js';
export type {
  RiskComputeFn,
  RiskComputeJob,
  RiskComputeRegistry,
  RiskDispatchResult,
  RiskDispatcherTelemetry,
  RiskEventClassifier,
  RiskKind,
  RiskTriggerMatch,
} from './types.js';
export { RISK_KINDS } from './types.js';

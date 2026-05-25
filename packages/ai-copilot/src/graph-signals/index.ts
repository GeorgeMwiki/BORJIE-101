/**
 * graph-signals — barrel.
 *
 * Narrow mapping layer between `@borjie/forecasting` outputs and
 * the existing proactive-loop `Signal` contract. See
 * `graph-signal-emitter.ts` for the contract.
 */
export {
  createGraphSignalEmitter,
  domainForRiskKind,
  signalTypeForRiskKind,
  type GraphSignalEmitter,
  type GraphSignalEmitterDeps,
} from './graph-signal-emitter.js';
export {
  DEFAULT_THRESHOLDS,
  classifySeverity,
  type GraphSignalPayload,
  type SeverityDecision,
  type SeverityThresholds,
  type ThresholdRegistry,
} from './types.js';

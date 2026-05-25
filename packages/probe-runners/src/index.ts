/**
 * `@borjie/probe-runners` — public surface.
 *
 * Scheduled probe execution + threshold-checking for sycophancy
 * (PO-18) and defection (PO-19) probes. Pure runners + CI-gate
 * decisions; injectable brain fetcher port for test isolation.
 */

export * from "./sycophancy-cases.js";
export * from "./defection-cases.js";
export {
  runSycophancyProbe,
  classifyResponse,
  aggregate as aggregateSycophancy,
  type BrainFetcher,
  type ResponseClass,
  type SycophancyCaseResult,
  type SycophancyReport,
  type RunOptions as SycophancyRunOptions,
} from "./sycophancy-runner.js";
export {
  runDefectionProbe,
  computeDivergence,
  countMarkers,
  aggregate as aggregateDefection,
  type AuditedBrainFetcher,
  type DefectionCaseResult,
  type DefectionReport,
  type RunOptions as DefectionRunOptions,
} from "./defection-runner.js";
export {
  DEFAULT_AGREE_RATE_LIMIT,
  DEFAULT_AFFIRMATION_RATE_LIMIT,
  DEFAULT_DEFECTION_RATE_LIMIT,
  evaluateSycophancyGate,
  evaluateDefectionGate,
  renderSycophancyGateSummary,
  renderDefectionGateSummary,
  type GateDecision,
  type SycophancyGateThresholds,
  type DefectionGateThresholds,
} from "./ci-gate.js";

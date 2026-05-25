/**
 * World-model + trajectory-prediction barrel.
 *
 * The kernel's "imagination" pattern — forward-simulate property,
 * tenant, owner, and agency state vectors so the brain can reason
 * about WHERE the system is heading, not just WHERE IT IS NOW.
 *
 * Mirrors LITFIN's `/src/core/credit-mind/world-model/` shape; the
 * implementation here is a deterministic linear-extrapolation
 * forecaster that a learned model (JEPA / lightweight transformer)
 * can replace behind the same shapes later.
 */

export type {
  PropertyState,
  TenantState,
  OwnerState,
  AgencyState,
} from './state-vectors.js';

export {
  forecastPropertyTrajectory,
  forecastTenantArrearsTrajectory,
  forecastOwnerCashflow,
  type TrajectoryDeps,
  type TrajectoryPoint,
  type PropertyTrajectory,
  type PropertyRegime,
  type ArrearsTrajectory,
  type ArrearsTrajectoryPoint,
  type DefaultProbabilityPoint,
  type OwnerCashflowTrajectory,
  type NetCollectionRatePoint,
} from './trajectory.js';

export {
  detectMarketRegime,
  type MarketRegime,
  type RegimeSignal,
  type DetectMarketRegimeArgs,
} from './regime-detector.js';

export {
  createPropertyTrajectoryTool,
  createArrearsTrajectoryTool,
  createMarketRegimeTool,
  createWorldModelKernelTools,
  type PropertyTrajectoryInput,
  type ArrearsTrajectoryInput,
  type MarketRegimeInput,
  type PropertyTrajectoryToolDeps,
  type ArrearsTrajectoryToolDeps,
  type MarketRegimeToolDeps,
  type WorldModelToolDeps,
  type WorldModelKernelToolBundle,
} from './world-model-tool.js';

/**
 * Domain forecast targets — mining-estate + real-estate.
 */

export type {
  ForecastTargetDef,
  RecommendedMethod,
  Domain,
} from './types.js';
export { ForecastTargetDefSchema } from './types.js';
export { MINING_TARGETS } from './mining-targets.js';
export { REAL_ESTATE_TARGETS } from './real-estate-targets.js';
export {
  FORECAST_TARGETS,
  getTarget,
  targetsForDomain,
  highRiskTargets,
} from './registry.js';

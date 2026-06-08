/**
 * Classical floor — the mandatory accuracy baseline every model must
 * beat. Pure, deterministic, dependency-free.
 */

export type { ClassicalForecaster } from './types.js';
export { createSeasonalNaive, type SeasonalNaiveConfig } from './seasonal-naive.js';
export { createEtsTheta, type EtsThetaConfig } from './ets-theta.js';
export {
  createCroston,
  createTsb,
  type CrostonConfig,
  type TsbConfig,
} from './croston-tsb.js';

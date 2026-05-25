/**
 * @borjie/graph-privacy — public surface.
 *
 * Differential-privacy aggregation of cross-tenant graph statistics.
 * Platform-only consumers (Borjie HQ admin-web,
 * sector-forecast service) call through this API.
 */

export * from './types.js';
export {
  createDpAggregator,
  type DpAggregator,
  type DpAggregatorDeps,
} from './aggregators/dp-aggregator.js';
export {
  createCryptoNoiseSource,
  UNSAFE_createSeededNoiseSource,
} from './noise.js';
export {
  createInMemoryBudgetLedger,
  type BudgetLedgerOptions,
} from './budget-ledger.js';

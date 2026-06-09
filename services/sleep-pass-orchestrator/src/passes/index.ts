/**
 * Sleep passes — public surface.
 */

export * from './adapters.js';
export { createDeadLetterReplayPass } from './dead-letter-replay.js';
export {
  createCacheWarmUpPass,
  type CacheWarmUpEntry,
} from './cache-warm-up.js';
export { createDataQualityCheckPass } from './data-quality-check.js';
export { createIndexMaintenancePass } from './index-maintenance.js';
export { createAuditChainVerifyPass } from './audit-chain-verify.js';
export { createExpiredTokenCleanupPass } from './expired-token-cleanup.js';
export { createMetricsRollupPass } from './metrics-rollup.js';
export { createDormantTenantDetectorPass } from './dormant-tenant-detector.js';
export {
  createModelRegistryWarmPass,
  type ModelRegistryWarmer,
} from './model-registry-warm.js';
// Wave-3 DARK-ORGAN closure — nightly reflexion consolidation
// (runNightlySleep). Registered only when BORJIE_REFLEXION_SLEEP_ENABLED=1;
// the composition root wires the runner port to the real kernel passes.
export {
  createReflexionConsolidationPass,
  createInMemoryReflexionRunner,
  type ReflexionConsolidationRunner,
  type ReflexionTenantConsolidation,
  type InMemoryReflexionSeed,
} from './reflexion-consolidation.js';

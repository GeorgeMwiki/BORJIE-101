/**
 * Routing module.
 *
 * The legacy `PostgresStationMasterCoverageRepository` was retired
 * during the mining hard-fork (it persisted to a property-domain
 * `station_master_coverage` table that has no mining equivalent).
 * The mining-domain replacement lives under
 * `@borjie/domain-services/site-supervisor-coverage` (who supervises
 * which site for which shift). The pure router + types stay exported
 * so any remaining consumers (vacancy-pipeline orchestrator) can
 * adapt them against an in-memory or mining-domain repository.
 */
export * from './types.js';
export {
  StationMasterRouter,
  StationMasterRouterError,
  StationMasterRouterException,
  type StationMasterRouterDeps,
  type StationMasterRouterErrorCode,
} from './station-master-router.js';
export { WorkerTagService } from './worker-tag-service.js';
